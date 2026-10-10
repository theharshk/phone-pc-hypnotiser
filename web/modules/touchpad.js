export default {
    id: 'touchpad',
    name: 'Touchpad',
    icon: '🖱️',
    
    mount(el, api) {
        this.el = el;
        this.api = api;
        
        el.innerHTML = `
            <div id="touchpad-area" style="width: 100%; height: 300px; background: #2a2a2a; border-radius: 8px; touch-action: none; display: flex; align-items: center; justify-content: center; user-select: none;">
                <span style="color: #666;">Touchpad Area</span>
            </div>
        `;
        
        const area = el.querySelector('#touchpad-area');
        
        let state = 'IDLE'; // IDLE, DRAGGING, SCROLLING, MOVING
        let lastTapTime = 0;
        let touchStartTime = 0;
        let startTouches = [];
        let lastTouches = [];
        
        let pendingDx = 0;
        let pendingDy = 0;
        let pendingScroll = 0;
        let frameRequested = false;
        
        const sendMove = () => {
            if (pendingDx !== 0 || pendingDy !== 0) {
                api.send('move', { dx: Math.round(pendingDx), dy: Math.round(pendingDy) });
                pendingDx = 0;
                pendingDy = 0;
            }
            if (pendingScroll !== 0) {
                const lines = Math.round(pendingScroll / 20);
                if (lines !== 0) {
                    api.send('scroll', { amount: lines });
                    pendingScroll = 0;
                }
            }
            frameRequested = false;
        };

        const requestSend = () => {
            if (!frameRequested) {
                frameRequested = true;
                requestAnimationFrame(sendMove);
            }
        };
        
        const getDistance = (t1, t2) => {
            const dx = t1.clientX - t2.clientX;
            const dy = t1.clientY - t2.clientY;
            return Math.sqrt(dx*dx + dy*dy);
        };
        
        area.addEventListener('touchstart', (e) => {
            e.preventDefault();
            const now = Date.now();
            touchStartTime = now;
            
            if (e.touches.length === 1) {
                const t = e.touches[0];
                if (now - lastTapTime < 300) {
                    state = 'DRAGGING';
                    api.send('down', {});
                } else {
                    state = 'MOVING';
                }
                startTouches = [{clientX: t.clientX, clientY: t.clientY}];
                lastTouches = [{clientX: t.clientX, clientY: t.clientY}];
            } else if (e.touches.length === 2) {
                state = 'SCROLLING';
                startTouches = [
                    {clientX: e.touches[0].clientX, clientY: e.touches[0].clientY},
                    {clientX: e.touches[1].clientX, clientY: e.touches[1].clientY}
                ];
                lastTouches = [...startTouches];
            }
        });
        
        area.addEventListener('touchmove', (e) => {
            e.preventDefault();
            
            if (state === 'MOVING' || state === 'DRAGGING') {
                if (e.touches.length === 1) {
                    const t = e.touches[0];
                    pendingDx += t.clientX - lastTouches[0].clientX;
                    pendingDy += t.clientY - lastTouches[0].clientY;
                    lastTouches[0] = {clientX: t.clientX, clientY: t.clientY};
                    requestSend();
                }
            } else if (state === 'SCROLLING') {
                if (e.touches.length === 2) {
                    const t1 = e.touches[0], t2 = e.touches[1];
                    const midY = (t1.clientY + t2.clientY) / 2;
                    const lastMidY = (lastTouches[0].clientY + lastTouches[1].clientY) / 2;
                    
                    pendingScroll += (lastMidY - midY);
                    
                    lastTouches = [
                        {clientX: t1.clientX, clientY: t1.clientY},
                        {clientX: t2.clientX, clientY: t2.clientY}
                    ];
                    requestSend();
                }
            }
        });
        
        area.addEventListener('touchend', (e) => {
            e.preventDefault();
            const now = Date.now();
            const duration = now - touchStartTime;
            
            if (state === 'MOVING') {
                if (e.changedTouches.length === 1 && startTouches.length > 0) {
                    const dist = getDistance(e.changedTouches[0], startTouches[0]);
                    if (dist < 10 && duration < 300) {
                        api.send('click', {});
                        lastTapTime = now;
                    }
                }
            } else if (state === 'DRAGGING') {
                api.send('up', {});
            } else if (state === 'SCROLLING') {
                if (duration < 300 && Math.abs(pendingScroll) < 10) {
                    api.send('rightClick', {});
                }
            }
            
            if (e.touches.length === 0) {
                state = 'IDLE';
                startTouches = [];
            }
            
            if (pendingDx !== 0 || pendingDy !== 0 || pendingScroll !== 0) {
                sendMove();
            }
        });
        
        // For testing on desktop
        let isMouseDown = false;
        area.addEventListener('mousedown', (e) => {
            isMouseDown = true;
            lastTouches = [{clientX: e.clientX, clientY: e.clientY}];
            if (e.button === 0) api.send('down', {});
            else if (e.button === 2) api.send('rightClick', {});
        });
        area.addEventListener('mousemove', (e) => {
            if (!isMouseDown) return;
            pendingDx += e.clientX - lastTouches[0].clientX;
            pendingDy += e.clientY - lastTouches[0].clientY;
            lastTouches[0] = {clientX: e.clientX, clientY: e.clientY};
            requestSend();
        });
        area.addEventListener('mouseup', (e) => {
            isMouseDown = false;
            if (e.button === 0) api.send('up', {});
        });
        area.addEventListener('contextmenu', e => e.preventDefault());
    },
    
    unmount() {
        if (this.el) {
            this.el.innerHTML = '';
        }
    }
};
