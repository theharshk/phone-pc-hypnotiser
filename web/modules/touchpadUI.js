function triggerHaptic(duration = 25) {
    try {
        if (typeof window !== 'undefined' && typeof window.__pr_triggerHaptic === 'function') {
            window.__pr_triggerHaptic(duration);
            return;
        }
        if (localStorage.getItem('pr_haptics') === 'false') return;
        if (typeof navigator !== 'undefined' && navigator.vibrate) {
            navigator.vibrate(duration);
        }
    } catch (e) {}
}

export const STREAM_SPEED_PRESETS = {
    'turbo': 5,
    'world_record': 55,
    'pro': 100,
    'fast': 160,
    'human': 215
};

export function resolveStreamDelay(setting) {
    if (typeof setting === 'number' && !isNaN(setting) && setting >= 1) return Math.min(1000, setting);
    return STREAM_SPEED_PRESETS[setting] ?? 5;
}

export function buildStreamTextPayload(text, delayMs) {
    const d = { text: text || '' };
    if (delayMs !== undefined) {
        d.delayMs = resolveStreamDelay(delayMs);
    }
    return { m: 'keyboard', t: 'stream_text', d };
}

export function buildCancelStreamPayload() {
    return { m: 'keyboard', t: 'cancel_stream', d: {} };
}

export function createUnifiedTouchpadAndKeyboard(container, api, isOverlay = true, modOptions = null) {
    const sendMod = (mod, type, data) => {
        if (api && api._ws && api._ws.readyState === 1) {
            api._ws.send(JSON.stringify({m: mod, t: type, d: data || {}}));
        } else if (api && typeof api.send === 'function') {
            api.send(type, data || {});
        }
    };

    // Hidden input for native keyboard
    const hiddenInput = document.createElement('input');
    hiddenInput.type = 'text';
    hiddenInput.style.cssText = 'position:fixed; top:0; left:0; opacity:0; pointer-events:none; z-index:-1;';
    document.body.appendChild(hiddenInput);
    
    const sendTextPayload = (text) => {
        if (!text) return;
        const mods = (modOptions && typeof modOptions.getMods === 'function') ? modOptions.getMods() : {};
        const hasMods = mods.ctrl || mods.alt || mods.shift || mods.win;
        if (hasMods && text.length === 1) {
            sendMod('keyboard', 'key', {code: text, ...mods, action: 'press'});
        } else {
            sendMod('keyboard', 'text', {text: text});
        }
        if (modOptions && typeof modOptions.onCharSent === 'function') {
            modOptions.onCharSent();
        }
    };

    hiddenInput.addEventListener('input', (e) => {
        if ((e.inputType === 'insertText' || e.inputType === 'insertFromPaste' || e.inputType === 'insertCompositionText') && e.data) {
            sendTextPayload(e.data);
        } else if (hiddenInput.value) {
            sendTextPayload(hiddenInput.value);
        }
        hiddenInput.value = '';
    });

    hiddenInput.addEventListener('paste', (e) => {
        let pastedText = '';
        if (e.clipboardData) {
            pastedText = e.clipboardData.getData('text');
        } else if (window.clipboardData) {
            pastedText = window.clipboardData.getData('Text');
        }
        if (pastedText) {
            e.preventDefault();
            sendTextPayload(pastedText);
            hiddenInput.value = '';
        }
    });
    hiddenInput.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' || e.key === 'Enter') {
            const mods = (modOptions && typeof modOptions.getMods === 'function') ? modOptions.getMods() : {};
            sendMod('keyboard', 'key', {code: e.key, ...mods, action: 'press'});
            if (modOptions && typeof modOptions.onCharSent === 'function') {
                modOptions.onCharSent();
            }
        }
    });

    // Unified Footer Toolbar
    const footerBar = document.createElement('div');
    footerBar.id = 'unified-footer-bar';
    footerBar.style.cssText = 'position:fixed; bottom:0; left:0; width:100%; padding:10px 14px; background:var(--card); border-top:1px solid var(--border); z-index:1000; display:flex; gap:10px; align-items:center; justify-content:space-between; box-sizing:border-box;';

    const typeBtn = document.createElement('button');
    typeBtn.id = 'kb-type-btn';
    typeBtn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none"><rect x="3" y="11" width="18" height="10" rx="2" ry="2"></rect><path d="M7 15h.01M11 15h.01M15 15h.01M7 17h10"></path><path d="M3 7h18"></path></svg> <span style="margin-left:6px">Keyboard</span>';
    typeBtn.style.cssText = 'background:var(--card-alt); color:var(--text); border:1px solid var(--border); border-radius:14px; padding:10px 8px; font-weight:600; font-size:0.9rem; display:flex; align-items:center; box-shadow:0 1px 4px rgba(0,0,0,0.15); flex:1; justify-content:center; white-space:nowrap;';
    typeBtn.onclick = () => { triggerHaptic(20); hiddenInput.focus(); };

    const pasteBtn = document.createElement('button');
    pasteBtn.id = 'kb-clipboard-paste-btn';
    pasteBtn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect></svg> <span style="margin-left:6px">Clipboard Paste</span>';
    pasteBtn.style.cssText = 'background:var(--card-alt); color:var(--text); border:1px solid var(--border); border-radius:14px; padding:10px 8px; font-weight:600; font-size:0.9rem; display:flex; align-items:center; box-shadow:0 1px 4px rgba(0,0,0,0.15); flex:1.2; justify-content:center; white-space:nowrap;';

    const modeBtn = document.createElement('button');
    modeBtn.id = 'kb-mode-btn';
    modeBtn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none"><rect x="4" y="4" width="16" height="16" rx="2" ry="2"></rect><line x1="4" y1="12" x2="20" y2="12"></line><line x1="12" y1="12" x2="12" y2="20"></line></svg> <span style="margin-left:6px">Touchpad</span>';
    modeBtn.style.cssText = 'background:var(--accent); color:#FFFFFF; border:1px solid var(--accent); border-radius:14px; padding:10px 8px; font-weight:600; font-size:0.9rem; display:flex; align-items:center; box-shadow:0 1px 4px rgba(0,0,0,0.15); flex:1; justify-content:center; transition: background 0.2s; white-space:nowrap;';

    footerBar.appendChild(typeBtn);
    footerBar.appendChild(pasteBtn);
    footerBar.appendChild(modeBtn);

    // Clipboard Paste Modal & Streaming state
    let pasteModal = null;
    let isStreaming = false;

    const closePasteModal = () => {
        if (pasteModal && pasteModal.parentNode) {
            pasteModal.parentNode.removeChild(pasteModal);
        }
        pasteModal = null;
        isStreaming = false;
    };

    const stopStream = () => {
        sendMod('keyboard', 'cancel_stream', {});
        closePasteModal();
    };

    const openPasteModal = () => {
        if (pasteModal || typeof document === 'undefined') return;

        pasteModal = document.createElement('div');
        pasteModal.id = 'pr-clipboard-modal';
        pasteModal.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.65); z-index:2000; display:flex; align-items:center; justify-content:center; padding:16px; box-sizing:border-box; backdrop-filter:blur(4px);';

        const card = document.createElement('div');
        card.style.cssText = 'background:var(--card); border:1px solid var(--border); border-radius:20px; width:100%; max-width:440px; padding:20px; box-shadow:0 12px 36px rgba(0,0,0,0.5); display:flex; flex-direction:column; gap:14px; box-sizing:border-box;';

        const titleRow = document.createElement('div');
        titleRow.style.cssText = 'display:flex; justify-content:space-between; align-items:center;';
        titleRow.innerHTML = '<span style="font-weight:700; font-size:1.1rem; color:var(--text);">Clipboard Paste</span>';

        const desc = document.createElement('div');
        desc.id = 'paste-modal-desc';
        desc.style.cssText = 'font-size:0.85rem; color:var(--text-muted, #888); line-height:1.4;';
        desc.textContent = 'Paste multi-line text, paragraphs, or code snippets below to stream naturally to your PC.';

        const textarea = document.createElement('textarea');
        textarea.id = 'paste-stream-input';
        textarea.placeholder = 'Paste text here...';
        textarea.style.cssText = 'width:100%; height:130px; background:var(--ground); color:var(--text); border:1px solid var(--border); border-radius:12px; padding:12px; font-size:0.95rem; line-height:1.4; resize:none; box-sizing:border-box; font-family:inherit; outline:none;';

        const statusContainer = document.createElement('div');
        statusContainer.id = 'paste-status-container';
        statusContainer.style.cssText = 'display:none; flex-direction:column; align-items:center; justify-content:center; padding:20px 0; gap:10px;';
        statusContainer.innerHTML = `
            <div style="display:flex; align-items:center; gap:10px; font-weight:600; color:var(--accent);">
                <svg width="22" height="22" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" style="animation: spin 1.2s linear infinite;">
                    <circle cx="12" cy="12" r="10" stroke-opacity="0.25"></circle>
                    <path d="M12 2a10 10 0 0 1 10 10"></path>
                </svg>
                <span>Typing to PC...</span>
            </div>
            <div style="font-size:0.85rem; color:var(--text-muted, #888);">Streaming character-by-character</div>
        `;

        const btnRow = document.createElement('div');
        btnRow.style.cssText = 'display:flex; gap:10px; justify-content:flex-end; width:100%;';

        const cancelBtn = document.createElement('button');
        cancelBtn.id = 'paste-cancel-btn';
        cancelBtn.textContent = 'Cancel';
        cancelBtn.style.cssText = 'flex:1; padding:12px; border-radius:12px; border:1px solid var(--border); background:var(--card-alt); color:var(--text); font-weight:600; font-size:0.95rem; cursor:pointer;';
        cancelBtn.onclick = () => {
            triggerHaptic(15);
            closePasteModal();
        };

        const typeToPcBtn = document.createElement('button');
        typeToPcBtn.id = 'paste-type-btn';
        typeToPcBtn.textContent = 'Type to PC';
        typeToPcBtn.style.cssText = 'flex:1.2; padding:12px; border-radius:12px; border:1px solid var(--accent); background:var(--accent); color:#FFFFFF; font-weight:700; font-size:0.95rem; cursor:pointer;';

        const stopBtn = document.createElement('button');
        stopBtn.id = 'paste-stop-btn';
        stopBtn.textContent = 'Stop';
        stopBtn.style.cssText = 'display:none; flex:1; padding:12px; border-radius:12px; border:1px solid #ef4444; background:#ef4444; color:#FFFFFF; font-weight:700; font-size:0.95rem; cursor:pointer;';
        stopBtn.onclick = () => {
            triggerHaptic(25);
            stopStream();
        };

        typeToPcBtn.onclick = () => {
            const text = textarea.value;
            if (!text) return;
            triggerHaptic(20);
            isStreaming = true;

            desc.style.display = 'none';
            textarea.style.display = 'none';
            statusContainer.style.display = 'flex';
            cancelBtn.style.display = 'none';
            typeToPcBtn.style.display = 'none';
            stopBtn.style.display = 'block';

            let savedSpeed = 'turbo';
            try {
                if (typeof localStorage !== 'undefined') {
                    savedSpeed = localStorage.getItem('pr_stream_speed') || 'turbo';
                }
            } catch (e) {}
            const delayMs = resolveStreamDelay(savedSpeed);

            sendMod('keyboard', 'stream_text', { text: text, delayMs: delayMs });
        };

        btnRow.appendChild(cancelBtn);
        btnRow.appendChild(typeToPcBtn);
        btnRow.appendChild(stopBtn);

        card.appendChild(titleRow);
        card.appendChild(desc);
        card.appendChild(textarea);
        card.appendChild(statusContainer);
        card.appendChild(btnRow);
        pasteModal.appendChild(card);

        const targetParent = (container && container.ownerDocument ? container.ownerDocument.body : (typeof document !== 'undefined' ? document.body : null));
        if (targetParent) {
            targetParent.appendChild(pasteModal);
        }

        textarea.focus();
    };

    pasteBtn.onclick = () => {
        triggerHaptic(20);
        openPasteModal();
    };

    // WebSocket / Module listener for stream_done
    const handleWsMessage = (event) => {
        try {
            const data = (typeof event.data === 'string') ? JSON.parse(event.data) : event.data;
            if (data && data.m === 'keyboard' && data.t === 'stream_done') {
                if (isStreaming) {
                    closePasteModal();
                }
            }
        } catch (e) {}
    };

    if (api && api._ws && typeof api._ws.addEventListener === 'function') {
        api._ws.addEventListener('message', handleWsMessage);
    }

    const prevApiOn = (api && typeof api.on === 'function') ? api.on : null;
    if (api) {
        api.on = (t, d) => {
            if (t === 'stream_done') {
                if (isStreaming) {
                    closePasteModal();
                }
            }
            if (prevApiOn) prevApiOn(t, d);
        };
    }
    
    // Touchpad Bottom Sheet / Overlay (glass allowed on bottom sheet overlay)
    const padSheet = document.createElement('div');
    if (isOverlay) {
        padSheet.style.cssText = 'position:fixed; bottom:0; left:0; width:100%; height:60%; background:var(--sheet-bg); border-top:1px solid var(--border); border-top-left-radius:24px; border-top-right-radius:24px; transform:translateY(100%); transition:transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275); z-index:1001; display:flex; flex-direction:column; padding:16px; box-shadow:0 -10px 40px rgba(0,0,0,0.5); box-sizing:border-box;';
    } else {
        padSheet.style.cssText = 'width:100%; height:100%; display:flex; flex-direction:column; padding:16px; box-sizing:border-box; background:var(--ground);';
    }
    
    const padHeader = document.createElement('div');
    padHeader.style.cssText = 'display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;';
    const padTitle = document.createElement('span');
    padTitle.textContent = 'Touchpad';
    padTitle.style.cssText = 'color:var(--text); font-weight:700; font-size:1.1rem;';
    
    const closeSheetBtn = document.createElement('button');
    closeSheetBtn.innerHTML = '<svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" fill="none"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
    closeSheetBtn.style.cssText = 'background:var(--card-alt); border:1px solid var(--border); color:var(--text); border-radius:50%; width:36px; height:36px; display:flex; align-items:center; justify-content:center;';
    closeSheetBtn.onclick = () => { triggerHaptic(15); padSheet.style.transform = 'translateY(100%)'; };
    
    padHeader.appendChild(padTitle);
    if (isOverlay) {
        padHeader.appendChild(closeSheetBtn);
    }
    padSheet.appendChild(padHeader);
    
    const trackpadArea = document.createElement('div');
    trackpadArea.style.cssText = 'flex:1; background:var(--ground); border-radius:16px; border:1px solid var(--border); position:relative; touch-action:none; display:flex; flex-direction:column; justify-content:flex-end; padding:8px; user-select:none; margin-bottom:12px;';
    
    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex; gap:8px; height:60px; width:100%;';
    
    const lBtn = document.createElement('button');
    lBtn.innerHTML = 'Left Click';
    lBtn.style.cssText = 'flex:1; background:var(--card-alt); color:var(--text); border:1px solid var(--border); border-radius:12px; font-weight:600; font-size:1rem; transition: background 0.1s;';
    lBtn.addEventListener('touchstart', (e) => { e.preventDefault(); triggerHaptic(25); lBtn.style.background = 'var(--card-active)'; sendMod('touchpad', 'click', {button:'left'}); }, {passive: false});
    lBtn.addEventListener('touchend', (e) => { e.preventDefault(); lBtn.style.background = 'var(--card-alt)'; }, {passive: false});
    lBtn.onmousedown = () => { triggerHaptic(25); lBtn.style.background = 'var(--card-active)'; sendMod('touchpad', 'click', {button:'left'}); };
    lBtn.onmouseup = () => { lBtn.style.background = 'var(--card-alt)'; };
    
    const rBtn = document.createElement('button');
    rBtn.innerHTML = 'Right Click';
    rBtn.style.cssText = 'flex:1; background:var(--card-alt); color:var(--text); border:1px solid var(--border); border-radius:12px; font-weight:600; font-size:1rem; transition: background 0.1s;';
    rBtn.addEventListener('touchstart', (e) => { e.preventDefault(); triggerHaptic(25); rBtn.style.background = 'var(--card-active)'; sendMod('touchpad', 'rightClick', {}); }, {passive: false});
    rBtn.addEventListener('touchend', (e) => { e.preventDefault(); rBtn.style.background = 'var(--card-alt)'; }, {passive: false});
    rBtn.onmousedown = () => { triggerHaptic(25); rBtn.style.background = 'var(--card-active)'; sendMod('touchpad', 'rightClick', {}); };
    rBtn.onmouseup = () => { rBtn.style.background = 'var(--card-alt)'; };
    
    btnRow.appendChild(lBtn);
    btnRow.appendChild(rBtn);
    padSheet.appendChild(trackpadArea);
    padSheet.appendChild(btnRow);
    
    // Attach complex touchpad logic
    attachTouchpadLogic(trackpadArea, sendMod);

    modeBtn.onclick = () => {
        triggerHaptic(20);
        padSheet.style.transform = 'translateY(0)';
    };

    if (isOverlay) {
        container.appendChild(footerBar);
    }
    container.appendChild(padSheet);

    return () => {
        if (api && api._ws && typeof api._ws.removeEventListener === 'function') {
            api._ws.removeEventListener('message', handleWsMessage);
        }
        if (hiddenInput.parentNode) hiddenInput.parentNode.removeChild(hiddenInput);
        closePasteModal();
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
    
    const getTouchpadSpeed = () => {
        try {
            const val = parseFloat(localStorage.getItem('pr_touchpad_speed') || '1.0');
            return (!isNaN(val) && val > 0) ? val : 1.0;
        } catch (e) {
            return 1.0;
        }
    };

    const sendMove = () => {
        if (pendingDx !== 0 || pendingDy !== 0) {
            const speed = getTouchpadSpeed();
            const dx = Math.round(pendingDx * speed);
            const dy = Math.round(pendingDy * speed);
            sendMod('touchpad', 'move', { dx, dy });
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
                    triggerHaptic(25);
                    sendMod('touchpad', 'click', {});
                    lastTapTime = now;
                }
            }
        } else if (state === 'DRAGGING') {
            sendMod('touchpad', 'up', {});
        } else if (state === 'SCROLLING') {
            if (duration < 300 && Math.abs(pendingScroll) < 10) {
                triggerHaptic(25);
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
