export function createUnifiedTouchpadAndKeyboard(container, api, isOverlay = true) {
    const sendMod = (mod, type, data) => {
        if (api._ws && api._ws.readyState === 1) {
            api._ws.send(JSON.stringify({m: mod, t: type, d: data || {}}));
        }
    };

    // Hidden input for native keyboard
    const hiddenInput = document.createElement('input');
    hiddenInput.type = 'text';
    hiddenInput.style.cssText = 'position:fixed; top:0; left:0; opacity:0; pointer-events:none; z-index:-1;';
    document.body.appendChild(hiddenInput);
    
    hiddenInput.addEventListener('input', (e) => {
        if (e.inputType === 'insertText') {
            sendMod('keyboard', 'text', {text: e.data});
        }
        hiddenInput.value = '';
    });
    hiddenInput.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' || e.key === 'Enter') {
            sendMod('keyboard', 'key', {code: e.key, action: 'press'});
        }
    });

    // Unified Footer Toolbar
    const footerBar = document.createElement('div');
    footerBar.style.cssText = 'position:fixed; bottom:0; left:0; width:100%; padding:12px 24px; background:rgba(0,0,0,0.65); backdrop-filter:blur(20px); border-top:1px solid rgba(255,255,255,0.1); z-index:1000; display:flex; gap:16px; align-items:center; justify-content:space-between; box-sizing:border-box;';

    const typeBtn = document.createElement('button');
    typeBtn.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none"><rect x="3" y="11" width="18" height="10" rx="2" ry="2"></rect><path d="M7 15h.01M11 15h.01M15 15h.01M7 17h10"></path><path d="M3 7h18"></path></svg> <span style="margin-left:8px">Keyboard</span>';
    typeBtn.style.cssText = 'background:rgba(255,255,255,0.15); color:white; border-radius:16px; padding:12px; font-weight:600; font-size:1rem; border:none; display:flex; align-items:center; box-shadow:0 2px 10px rgba(0,0,0,0.2); flex:1; justify-content:center;';
    typeBtn.onclick = () => { hiddenInput.focus(); };

    const modeBtn = document.createElement('button');
    modeBtn.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none"><rect x="4" y="4" width="16" height="16" rx="2" ry="2"></rect><line x1="4" y1="12" x2="20" y2="12"></line><line x1="12" y1="12" x2="12" y2="20"></line></svg> <span style="margin-left:8px">Touchpad</span>';
    modeBtn.style.cssText = 'background:var(--accent); color:white; border-radius:16px; padding:12px; font-weight:600; font-size:1rem; border:none; display:flex; align-items:center; box-shadow:0 2px 10px rgba(0,0,0,0.2); flex:1; justify-content:center; transition: background 0.2s;';

    footerBar.appendChild(typeBtn);
    footerBar.appendChild(modeBtn);
    
    // Touchpad Bottom Sheet / Overlay
    const padSheet = document.createElement('div');
    if (isOverlay) {
        padSheet.style.cssText = 'position:fixed; bottom:0; left:0; width:100%; height:60%; background:rgba(28,28,30,0.95); backdrop-filter:blur(20px); border-top-left-radius:24px; border-top-right-radius:24px; transform:translateY(100%); transition:transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275); z-index:1001; display:flex; flex-direction:column; padding:16px; box-shadow:0 -10px 40px rgba(0,0,0,0.5); box-sizing:border-box;';
    } else {
        padSheet.style.cssText = 'width:100%; height:100%; display:flex; flex-direction:column; padding:16px; box-sizing:border-box;';
    }
    
    const padHeader = document.createElement('div');
    padHeader.style.cssText = 'display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;';
    const padTitle = document.createElement('span');
    padTitle.textContent = 'Touchpad';
    padTitle.style.cssText = 'color:white; font-weight:700; font-size:1.1rem;';
    
    const closeSheetBtn = document.createElement('button');
    closeSheetBtn.innerHTML = '<svg viewBox="0 0 24 24" width="24" height="24" stroke="white" stroke-width="2" fill="none"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
    closeSheetBtn.style.cssText = 'background:rgba(255,255,255,0.1); border-radius:50%; width:36px; height:36px; border:none; display:flex; align-items:center; justify-content:center;';
    closeSheetBtn.onclick = () => { padSheet.style.transform = 'translateY(100%)'; };
    
    padHeader.appendChild(padTitle);
    if (isOverlay) {
        padHeader.appendChild(closeSheetBtn);
    }
    padSheet.appendChild(padHeader);
    
    const trackpadArea = document.createElement('div');
    trackpadArea.style.cssText = 'flex:1; background:rgba(0,0,0,0.3) radial-gradient(rgba(255,255,255,0.15) 1px, transparent 1px); background-size:16px 16px; border-radius:16px; border:1px solid rgba(255,255,255,0.05); position:relative; touch-action:none; display:flex; flex-direction:column; justify-content:flex-end; padding:8px; align-items:center; user-select:none; margin-bottom:12px;';
    
    const hint = document.createElement('div');
    hint.textContent = 'Drag to move. Tap to click. Two fingers to scroll.';
    hint.style.cssText = 'position:absolute; top:50%; left:50%; transform:translate(-50%, -50%); color:var(--muted); font-size:0.95rem; text-align:center; pointer-events:none; width:80%; font-weight:500;';
    trackpadArea.appendChild(hint);
    
    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex; gap:8px; height:60px; width:100%;';
    
    const lBtn = document.createElement('button');
    lBtn.innerHTML = 'Left Click';
    lBtn.style.cssText = 'flex:1; background:rgba(255,255,255,0.1); color:white; border-radius:12px; border:none; font-weight:600; font-size:1rem; transition: background 0.1s;';
    lBtn.addEventListener('touchstart', (e) => { e.preventDefault(); lBtn.style.background = 'rgba(255,255,255,0.3)'; sendMod('touchpad', 'click', {button:'left'}); });
    lBtn.addEventListener('touchend', (e) => { e.preventDefault(); lBtn.style.background = 'rgba(255,255,255,0.1)'; });
    lBtn.onmousedown = () => { lBtn.style.background = 'rgba(255,255,255,0.3)'; sendMod('touchpad', 'click', {button:'left'}); };
    lBtn.onmouseup = () => { lBtn.style.background = 'rgba(255,255,255,0.1)'; };
    
    const rBtn = document.createElement('button');
    rBtn.innerHTML = 'Right Click';
    rBtn.style.cssText = 'flex:1; background:rgba(255,255,255,0.1); color:white; border-radius:12px; border:none; font-weight:600; font-size:1rem; transition: background 0.1s;';
    rBtn.addEventListener('touchstart', (e) => { e.preventDefault(); rBtn.style.background = 'rgba(255,255,255,0.3)'; sendMod('touchpad', 'rightClick', {}); });
    rBtn.addEventListener('touchend', (e) => { e.preventDefault(); rBtn.style.background = 'rgba(255,255,255,0.1)'; });
    rBtn.onmousedown = () => { rBtn.style.background = 'rgba(255,255,255,0.3)'; sendMod('touchpad', 'rightClick', {}); };
    rBtn.onmouseup = () => { rBtn.style.background = 'rgba(255,255,255,0.1)'; };
    
    btnRow.appendChild(lBtn);
    btnRow.appendChild(rBtn);
    padSheet.appendChild(trackpadArea);
    padSheet.appendChild(btnRow);
    
    // Attach complex touchpad logic
    attachTouchpadLogic(trackpadArea, sendMod);

    modeBtn.onclick = () => {
        padSheet.style.transform = 'translateY(0)';
    };

    if (isOverlay) {
        container.appendChild(footerBar);
    }
    container.appendChild(padSheet);

    return () => {
        if (hiddenInput.parentNode) hiddenInput.parentNode.removeChild(hiddenInput);
    };
}

function attachTouchpadLogic(area, sendMod) {
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
            sendMod('touchpad', 'move', { dx: Math.round(pendingDx), dy: Math.round(pendingDy) });
            pendingDx = 0;
            pendingDy = 0;
        }
        if (pendingScroll !== 0) {
            const lines = Math.round(pendingScroll / 20);
            if (lines !== 0) {
                sendMod('touchpad', 'scroll', { amount: lines });
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
                sendMod('touchpad', 'down', {});
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
    }, {passive: false});
    
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
    }, {passive: false});
    
    area.addEventListener('touchend', (e) => {
        e.preventDefault();
        const now = Date.now();
        const duration = now - touchStartTime;
        
        if (state === 'MOVING') {
            if (e.changedTouches.length === 1 && startTouches.length > 0) {
                const dist = getDistance(e.changedTouches[0], startTouches[0]);
                if (dist < 10 && duration < 300) {
                    sendMod('touchpad', 'click', {});
                    lastTapTime = now;
                }
            }
        } else if (state === 'DRAGGING') {
            sendMod('touchpad', 'up', {});
        } else if (state === 'SCROLLING') {
            if (duration < 300 && Math.abs(pendingScroll) < 10) {
                sendMod('touchpad', 'rightClick', {});
            }
        }
        
        if (e.touches.length === 0) {
            state = 'IDLE';
            startTouches = [];
        }
        
        if (pendingDx !== 0 || pendingDy !== 0 || pendingScroll !== 0) {
            sendMove();
        }
    }, {passive: false});
}
