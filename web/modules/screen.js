import { createUnifiedTouchpadAndKeyboard } from './touchpadUI.js';
export default {
    id: 'screen',
    name: 'Screen',
    icon: '📺',

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
        qualIn.style.cssText = 'width:45px; background:transparent; border:none; color:white; border-bottom:1px solid rgba(255,255,255,0.3); font-family:var(--font-mono);';
        qualLbl.appendChild(qualIn);
        
        const scaleLbl = document.createElement('label');
        scaleLbl.textContent = ' Scale: ';
        const scaleIn = document.createElement('input');
        scaleIn.type = 'number';
        scaleIn.min = 25; scaleIn.max = 100; scaleIn.value = 100;
        scaleIn.style.cssText = 'width:45px; background:transparent; border:none; color:white; border-bottom:1px solid rgba(255,255,255,0.3); font-family:var(--font-mono);';
        scaleLbl.appendChild(scaleIn);
        
        const applyBtn = document.createElement('button');
        applyBtn.textContent = 'Apply';
        applyBtn.style.cssText = 'background:var(--accent); color:var(--on-accent); border:none; border-radius:12px; padding:4px 12px; font-weight:600; margin-left:8px;';
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

        
        this.cleanupUI = createUnifiedTouchpadAndKeyboard(container, api, true);

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
            if (this.cleanupUI) this.cleanupUI();
            if (false) {
                hiddenInput.parentNode.removeChild(hiddenInput);
            }
        };
    },

    unmount: function() {
        if (this.cleanup) this.cleanup();
    }
}
