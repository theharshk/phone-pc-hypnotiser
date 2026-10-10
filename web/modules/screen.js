export default {
    id: 'screen',
    name: 'Screen',
    icon: '🖥️',

    mount: function(container, api) {
        const root = document.createElement('div');
        root.style.cssText = 'display:flex;flex-direction:column;align-items:center;width:100%;';
        
        const controls = document.createElement('div');
        controls.style.marginBottom = '10px';
        
        const fpsLbl = document.createElement('label');
        fpsLbl.textContent = 'FPS: ';
        const fpsIn = document.createElement('input');
        fpsIn.type = 'number';
        fpsIn.min = 1; fpsIn.max = 30; fpsIn.value = 10;
        fpsIn.style.width = '40px';
        fpsLbl.appendChild(fpsIn);
        
        const qualLbl = document.createElement('label');
        qualLbl.textContent = ' Qual: ';
        const qualIn = document.createElement('input');
        qualIn.type = 'number';
        qualIn.min = 30; qualIn.max = 90; qualIn.value = 80;
        qualIn.style.width = '45px';
        qualLbl.appendChild(qualIn);
        
        const scaleLbl = document.createElement('label');
        scaleLbl.textContent = ' Scale: ';
        const scaleIn = document.createElement('input');
        scaleIn.type = 'number';
        scaleIn.min = 25; scaleIn.max = 100; scaleIn.value = 100;
        scaleIn.style.width = '45px';
        scaleLbl.appendChild(scaleIn);
        
        const applyBtn = document.createElement('button');
        applyBtn.textContent = 'Apply';
        applyBtn.style.marginLeft = '5px';
        applyBtn.onclick = () => {
            api.send('settings', {
                fps: parseInt(fpsIn.value),
                quality: parseInt(qualIn.value),
                scale: parseInt(scaleIn.value)
            });
        };
        
        controls.appendChild(fpsLbl);
        controls.appendChild(qualLbl);
        controls.appendChild(scaleLbl);
        controls.appendChild(applyBtn);
        root.appendChild(controls);

        const fullscreenContainer = document.createElement('div');
        fullscreenContainer.style.width = '100%';
        fullscreenContainer.style.display = 'flex';
        fullscreenContainer.style.alignItems = 'center';
        fullscreenContainer.style.justifyContent = 'center';
        fullscreenContainer.style.background = '#000';
        fullscreenContainer.style.position = 'relative';

        const canvasWrapper = document.createElement('div');
        canvasWrapper.style.position = 'relative';
        canvasWrapper.style.display = 'inline-block';
        canvasWrapper.style.maxWidth = '100%';
        canvasWrapper.style.maxHeight = '100%';
        
        const img = document.createElement('img');
        img.style.display = 'block';
        img.style.maxWidth = '100%';
        img.style.maxHeight = '100vh';
        img.style.pointerEvents = 'auto';
        img.style.userSelect = 'none';
        img.style.webkitUserSelect = 'none';
        canvasWrapper.appendChild(img);
        
        const cursor = document.createElement('div');
        cursor.style.width = '2px';
        cursor.style.height = '2px';
        cursor.style.border = '2px solid white';
        cursor.style.boxShadow = '0 0 3px rgba(0,0,0,0.8)';
        cursor.style.background = 'transparent';
        cursor.style.borderRadius = '50%';
        cursor.style.position = 'absolute';
        cursor.style.pointerEvents = 'none';
        cursor.style.top = '0';
        cursor.style.left = '0';
        cursor.style.transform = 'translate(-50%, -50%)';
        cursor.style.transition = 'opacity 0.3s ease';
        cursor.style.opacity = '0';
        canvasWrapper.appendChild(cursor);
        
        fullscreenContainer.appendChild(canvasWrapper);

        const fsBtn = document.createElement('button');
        fsBtn.innerHTML = '&#x26F6;'; // Fullscreen symbol
        fsBtn.style.position = 'absolute';
        fsBtn.style.bottom = '15px';
        fsBtn.style.right = '15px';
        fsBtn.style.padding = '10px';
        fsBtn.style.fontSize = '20px';
        fsBtn.style.background = 'rgba(0,0,0,0.6)';
        fsBtn.style.color = 'white';
        fsBtn.style.border = 'none';
        fsBtn.style.borderRadius = '8px';
        fsBtn.style.cursor = 'pointer';
        fsBtn.style.zIndex = '10';
        
        fsBtn.onclick = () => {
            if (!document.fullscreenElement) {
                fullscreenContainer.requestFullscreen().then(() => {
                    if (screen.orientation && screen.orientation.lock) {
                        screen.orientation.lock('landscape').catch(() => {});
                    }
                }).catch(err => {
                    console.error("Fullscreen failed:", err);
                });
            } else {
                document.exitFullscreen();
            }
        };
        fullscreenContainer.appendChild(fsBtn);

        // Unified Footer Toolbar (Keyboard + Trackpad Modes)
        const footerBar = document.createElement('div');
        footerBar.style.cssText = 'position:fixed; bottom:0; left:0; width:100%; padding:12px; background:rgba(0,0,0,0.65); backdrop-filter:blur(20px); border-top:1px solid rgba(255,255,255,0.1); z-index:1000; display:flex; gap:8px; align-items:center; justify-content:center; flex-wrap:wrap;';

        const typeBtn = document.createElement('button');
        typeBtn.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none"><rect x="3" y="11" width="18" height="10" rx="2" ry="2"></rect><path d="M7 15h.01M11 15h.01M15 15h.01M7 17h10"></path><path d="M3 7h18"></path></svg> <span style="margin-left:4px">Keyboard</span>';
        typeBtn.style.cssText = 'background:rgba(255,255,255,0.15); color:white; border-radius:12px; padding:10px 20px; font-weight:600; font-size:0.9rem; border:none; display:flex; align-items:center; box-shadow:0 2px 10px rgba(0,0,0,0.2); flex:1; justify-content:center;';
        
        // Hidden input to trigger native keyboard
        const hiddenInput = document.createElement('input');
        hiddenInput.type = 'text';
        hiddenInput.style.cssText = 'position:absolute; opacity:0; pointer-events:none;';
        typeBtn.appendChild(hiddenInput);
        
        hiddenInput.addEventListener('input', (e) => {
            if (e.inputType === 'insertText') {
                api.send('type', {text: e.data});
            }
            hiddenInput.value = '';
        });
        hiddenInput.addEventListener('keydown', (e) => {
            if (e.key === 'Backspace' || e.key === 'Enter') {
                api.send('key', {key: e.key});
            }
        });
        
        typeBtn.onclick = () => { hiddenInput.focus(); };

        const lBtn = document.createElement('button');
        lBtn.innerHTML = 'Left Click';
        lBtn.style.cssText = 'background:rgba(255,255,255,0.1); color:white; border-radius:12px; padding:10px; font-weight:600; font-size:0.9rem; border:none; flex:1;';
        lBtn.onclick = () => api.send('click', {button:'left'});
        
        const rBtn = document.createElement('button');
        rBtn.innerHTML = 'Right Click';
        rBtn.style.cssText = 'background:rgba(255,255,255,0.1); color:white; border-radius:12px; padding:10px; font-weight:600; font-size:0.9rem; border:none; flex:1;';
        rBtn.onclick = () => api.send('click', {button:'right'});
        
        footerBar.appendChild(typeBtn);
        footerBar.appendChild(lBtn);
        footerBar.appendChild(rBtn);
        
        container.appendChild(footerBar);
        
        // Trackpad logic layered over the screen (so they can swipe anywhere)
        let isRelativeMode = false;
        let lastTouch = null;
        const toggleModeBtn = document.createElement('button');
        toggleModeBtn.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none"><rect x="4" y="4" width="16" height="16" rx="2" ry="2"></rect><line x1="4" y1="12" x2="20" y2="12"></line><line x1="12" y1="12" x2="12" y2="20"></line></svg>';
        toggleModeBtn.style.cssText = 'position:absolute; bottom:85px; right:16px; background:var(--accent); color:white; border-radius:50%; width:48px; height:48px; display:flex; align-items:center; justify-content:center; border:none; box-shadow:0 4px 12px rgba(0,0,0,0.3); z-index:900;';
        container.appendChild(toggleModeBtn);

        const modeBadge = document.createElement('div');
        modeBadge.textContent = 'Touch Mode';
        modeBadge.style.cssText = 'position:absolute; top:75px; left:50%; transform:translateX(-50%); background:rgba(0,0,0,0.5); backdrop-filter:blur(10px); color:white; padding:6px 16px; border-radius:20px; font-size:0.9rem; font-weight:600; z-index:900; pointer-events:none; opacity:0.8; transition:opacity 0.3s;';
        container.appendChild(modeBadge);

        toggleModeBtn.onclick = () => {
            isRelativeMode = !isRelativeMode;
            modeBadge.textContent = isRelativeMode ? 'Trackpad Mode' : 'Touch Mode';
            modeBadge.style.opacity = '1';
            setTimeout(() => { modeBadge.style.opacity = '0.5'; }, 1500);
            toggleModeBtn.style.background = isRelativeMode ? '#32d74b' : 'var(--accent)';
        };

        // Attach listeners to the full window to capture drag events anywhere
        img.addEventListener('touchstart', (e) => {
            if (isRelativeMode) {
                e.preventDefault();
                lastTouch = {x: e.touches[0].clientX, y: e.touches[0].clientY};
            }
        }, {passive: false});
        
        img.addEventListener('touchmove', (e) => {
            if (isRelativeMode && lastTouch) {
                e.preventDefault();
                const dx = e.touches[0].clientX - lastTouch.x;
                const dy = e.touches[0].clientY - lastTouch.y;
                api.send('move', {dx, dy});
                lastTouch = {x: e.touches[0].clientX, y: e.touches[0].clientY};
            }
        }, {passive: false});
        
        img.addEventListener('touchend', () => { lastTouch = null; });
        
        root.appendChild(fullscreenContainer);
        container.appendChild(root);

        img.onclick = (e) => {
            if (isRelativeMode) return;
            const rect = img.getBoundingClientRect();
            const nx = (e.clientX - rect.left) / rect.width;
            const ny = (e.clientY - rect.top) / rect.height;
            api.send('tap', {x: nx, y: ny, button: 'left'});
        };

        img.oncontextmenu = (e) => {
            e.preventDefault();
            const rect = img.getBoundingClientRect();
            const nx = (e.clientX - rect.left) / rect.width;
            const ny = (e.clientY - rect.top) / rect.height;
            api.send('tap', {x: nx, y: ny, button: 'right'});
        };

        const handleVisibility = () => {
            if (document.hidden) {
                api.send('settings', {fps: 1, quality: 30, scale: 25}); // minimum while hidden
            } else {
                applyBtn.click(); // restore
            }
        };
        document.addEventListener('visibilitychange', handleVisibility);

        let cursorTimeout = null;

        const wakeCursor = () => {
            cursor.style.opacity = '1';
            if (cursorTimeout) clearTimeout(cursorTimeout);
            cursorTimeout = setTimeout(() => {
                cursor.style.opacity = '0';
            }, 2500);
        };

        img.addEventListener('touchstart', wakeCursor, {passive: true});
        img.addEventListener('mousemove', wakeCursor, {passive: true});
        img.addEventListener('mousedown', wakeCursor, {passive: true});

        api.on = async (type, data) => {
            if (type === 'cursor') {
                cursor.style.left = (data.x * 100) + '%';
                cursor.style.top = (data.y * 100) + '%';
            }
        };

        const ws = api._ws;
        let msgHandler = null;
        let lastUrl = null;
        
        if (ws) {
            ws.binaryType = 'blob';
            msgHandler = async (e) => {
                if (e.data instanceof Blob) {
                    const buf = await e.data.arrayBuffer();
                    const view = new DataView(buf);
                    const msgType = view.getUint8(0);
                    if (msgType === 1) { // Screen Frame
                        const seq = view.getUint16(6);
                        const jpegData = e.data.slice(8, e.data.size, 'image/jpeg');
                        
                        const url = URL.createObjectURL(jpegData);
                        const tempImg = new Image();
                        tempImg.src = url;
                        
                        try {
                            await tempImg.decode();
                            img.src = url;
                            if (lastUrl) URL.revokeObjectURL(lastUrl);
                            lastUrl = url;
                            api.send('ack', {seq: seq});
                        } catch (err) {
                            // decode failed or aborted
                            URL.revokeObjectURL(url);
                        }
                    }
                }
            };
            ws.addEventListener('message', msgHandler);
        }

        // Force send the default UI settings to the server immediately
        setTimeout(() => applyBtn.click(), 100);

        this.cleanup = () => {
            document.removeEventListener('visibilitychange', handleVisibility);
            if (ws && msgHandler) {
                ws.removeEventListener('message', msgHandler);
            }
            if (lastUrl) {
                URL.revokeObjectURL(lastUrl);
                lastUrl = null;
            }
        };
    },

    unmount: function() {
        if (this.cleanup) this.cleanup();
    }
}
