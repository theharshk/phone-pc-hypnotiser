const statusIndicator = document.getElementById('status-indicator');
const statusText = document.getElementById('status-text');
const moduleContainer = document.getElementById('module-container');
const activeModuleContainer = document.getElementById('active-module');

let ws = null;
let reconnectTimer = null;
let pingInterval = null;
let currentDelay = 500;
let activeModule = null;
let activeModuleId = null;
let activeModuleApi = null;
let loadedModules = {};
let availableModules = [];
let currentLayout = [];
let isEditMode = false;
let isRevoked = false;

function updateStatus(state, text) {
    statusIndicator.className = state;
    statusText.textContent = text;
    
    const dot = document.getElementById('module-status-dot');
    if (dot) {
        if (state === 'connected') dot.style.background = '#32d74b'; // green
        else if (state === 'reconnecting') dot.style.background = '#ffbd2e'; // yellow
        else dot.style.background = '#ff453a'; // red
    }
}

const authOverlay = document.createElement('div');
authOverlay.id = 'auth-overlay';
authOverlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:#222;z-index:100;display:flex;flex-direction:column;align-items:center;justify-content:center;color:white;text-align:center;display:none;';
document.body.appendChild(authOverlay);

function showAuthOverlay(html) {
    authOverlay.innerHTML = html;
    authOverlay.style.display = 'flex';
}

function hideAuthOverlay() {
    authOverlay.style.display = 'none';
}

function renderHomeScreen() {
    moduleContainer.innerHTML = '';
    moduleContainer.style.display = 'block';
    activeModuleContainer.style.display = 'none';

    // Header controls
    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.alignItems = 'center';
    header.style.marginBottom = '24px';
    
    const title = document.createElement('h2');
    title.textContent = 'Modules';
    title.style.margin = '0';
    title.style.fontSize = '1.3rem';
    header.appendChild(title);
    
    const editBtn = document.createElement('button');
    editBtn.textContent = isEditMode ? 'Done' : 'Edit';
    editBtn.style.cssText = 'background:rgba(255,255,255,0.1); color:var(--accent); font-weight:600; padding:8px 16px; border-radius:20px; font-size:0.95rem;';
    editBtn.onclick = () => {
        isEditMode = !isEditMode;
        if (isEditMode) document.body.classList.add('edit-mode');
        else document.body.classList.remove('edit-mode');
        renderHomeScreen();
    };
    header.appendChild(editBtn);
    moduleContainer.appendChild(header);

    const grid = document.createElement('div');
    grid.className = 'grid-container';

    // Icons map for modules
    const icons = {
        'screen': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>',
        'keyboard': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2" ry="2"></rect><path d="M6 8h.001M10 8h.001M14 8h.001M18 8h.001M8 12h.001M12 12h.001M16 12h.001M7 16h10"></path></svg>',
        'touchpad': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2" ry="2"></rect><line x1="4" y1="12" x2="20" y2="12"></line><line x1="12" y1="12" x2="12" y2="20"></line></svg>',
        'media': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>',
        'power': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"></path><line x1="12" y1="2" x2="12" y2="12"></line></svg>'
    };

    // Render tiles
    currentLayout.forEach((modId, index) => {
        const modInfo = availableModules.find(m => m.id === modId) || { id: modId, name: modId };
        
        const tile = document.createElement('div');
        tile.className = 'module-tile';
        
        tile.innerHTML = `
            ${icons[modId] || '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>'}
            <span>${modInfo.name}</span>
        `;
        
        if (!isEditMode) {
            tile.onclick = () => openModule(modId);
            // Long press to enter edit mode
            let pressTimer;
            tile.ontouchstart = () => { pressTimer = setTimeout(() => { isEditMode = true; document.body.classList.add('edit-mode'); renderHomeScreen(); }, 600); };
            tile.ontouchend = () => clearTimeout(pressTimer);
            tile.onmousedown = tile.ontouchstart;
            tile.onmouseup = tile.ontouchend;
            tile.onmouseleave = tile.ontouchend;
        }

        if (isEditMode) {
            const controls = document.createElement('div');
            controls.style.cssText = 'position:absolute; top:-8px; left:-8px; background:var(--danger); border-radius:50%; width:28px; height:28px; display:flex; align-items:center; justify-content:center; color:white; font-weight:bold; cursor:pointer; box-shadow:0 2px 8px rgba(0,0,0,0.3);';
            controls.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><line x1="5" y1="12" x2="19" y2="12"></line></svg>';
            controls.onclick = (e) => {
                e.stopPropagation();
                currentLayout.splice(index, 1);
                saveLayout();
                renderHomeScreen();
            };
            tile.appendChild(controls);
        }

        grid.appendChild(tile);
    });
    
    moduleContainer.appendChild(grid);

    if (isEditMode) {
        const unadded = availableModules.filter(m => !currentLayout.includes(m.id));
        if (unadded.length > 0) {
            const addSelect = document.createElement('select');
            addSelect.style.cssText = 'margin-top: 24px; width: 100%; padding: 12px; border-radius: 12px; background: var(--card); color: white; border: 1px solid rgba(255,255,255,0.1); font-size: 1rem; outline: none;';
            addSelect.innerHTML = '<option value="">+ Add Module</option>';
            unadded.forEach(m => {
                const opt = document.createElement('option');
                opt.value = m.id;
                opt.textContent = m.name;
                addSelect.appendChild(opt);
            });
            addSelect.onchange = (e) => {
                if (e.target.value) {
                    currentLayout.push(e.target.value);
                    saveLayout();
                    renderHomeScreen();
                }
            };
            moduleContainer.appendChild(addSelect);
        }
    }
}

function saveLayout() {
    localStorage.setItem('pr_layout', JSON.stringify(currentLayout));
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({m: 'core', t: 'set_layout', d: {layout: currentLayout}}));
    }
}

function closeActiveModule() {
    if (activeModule) {
        activeModule.unmount();
        ws.send(JSON.stringify({m: 'core', t: 'close', d: {module: activeModuleId}}));
    }
    activeModule = null;
    activeModuleId = null;
    activeModuleContainer.innerHTML = '';
    renderHomeScreen();
}

window.addEventListener('popstate', (e) => {
    if (activeModule) {
        closeActiveModule();
    }
});

async function openModule(id) {
    if (activeModule) {
        closeActiveModule();
    }
    
    window.history.pushState({module: id}, '', '#' + id);
    
    moduleContainer.style.display = 'none';
    activeModuleContainer.style.display = 'flex';
    
    const headerBar = document.createElement('div');
    headerBar.style.cssText = 'width:100%; height:60px; background:rgba(0,0,0,0.65); backdrop-filter:blur(20px); border-bottom:1px solid rgba(255,255,255,0.1); display:flex; align-items:center; padding:0 16px; z-index:1000; flex-shrink:0;';
    
    const backBtn = document.createElement('button');
    backBtn.innerHTML = '<svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" fill="none" style="margin-right:4px;"><polyline points="15 18 9 12 15 6"></polyline></svg> Home';
    backBtn.style.cssText = 'background:transparent; color:var(--accent); font-weight:600; font-size:1.1rem; display:flex; align-items:center; padding:8px 0; border:none;';
    backBtn.onclick = () => {
        window.history.back(); // Triggers popstate which calls closeActiveModule
    };
    
    const title = document.createElement('span');
    title.textContent = availableModules.find(m => m.id === id)?.name || id;
    title.style.cssText = 'position:absolute; left:50%; transform:translateX(-50%); font-weight:600; font-size:1.1rem;';
    
    const statusDot = document.createElement('div');
    statusDot.id = 'module-status-dot';
    statusDot.style.cssText = 'width:12px; height:12px; border-radius:50%; margin-left:auto; transition: background 0.3s;';
    
    headerBar.appendChild(backBtn);
    headerBar.appendChild(title);
    headerBar.appendChild(statusDot);
    activeModuleContainer.appendChild(headerBar);
    
    // Set initial color based on current statusIndicator
    if (statusIndicator.className === 'connected') statusDot.style.background = '#32d74b';
    else if (statusIndicator.className === 'reconnecting') statusDot.style.background = '#ffbd2e';
    else statusDot.style.background = '#ff453a';

    const modContainer = document.createElement('div');
    modContainer.style.cssText = 'flex:1; width:100%; position:relative; overflow:auto;';
    activeModuleContainer.appendChild(modContainer);

    try {
        if (!loadedModules[id]) {
            const module = await import('./modules/' + id + '.js?v=' + Date.now());
            loadedModules[id] = module.default;
        }
        
        activeModule = loadedModules[id];
        activeModuleId = id;
        ws.send(JSON.stringify({m: 'core', t: 'open', d: {module: id}}));
        
        activeModuleApi = {
            send: (type, data) => {
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({m: id, t: type, d: data}));
                }
            },
            on: null,
            _ws: ws
        };
        
        activeModule.mount(modContainer, activeModuleApi);
    } catch (e) {
        console.error("Failed to load module " + id, e);
        backBtn.click();
    }
}

let lockoutTimer = null;
let lockoutAnnounceTimer = null;
let currentEnteredPin = "";

function renderPinScreen() {
    currentEnteredPin = "";
    if (lockoutTimer) { clearInterval(lockoutTimer); lockoutTimer = null; }
    if (lockoutAnnounceTimer) { clearInterval(lockoutAnnounceTimer); lockoutAnnounceTimer = null; }

    showAuthOverlay(`
        <div id="pin-screen-container" style="display:flex; flex-direction:column; align-items:center; width:100%; max-width:320px;">
            <div id="pin-live-region" class="sr-only" aria-live="polite" aria-atomic="true"></div>
            <h2 id="pin-screen-title" style="font-size:2rem; font-weight:700; margin-bottom:8px;">Enter PIN</h2>
            <p id="pin-screen-subtitle" style="color:var(--muted); margin-bottom:24px; font-size:0.95rem;">Please enter the 6-digit PIN displayed on your PC.</p>
            
            <div id="pin-boxes" style="display:flex; gap:8px; margin-bottom:20px;" aria-label="PIN digits" tabindex="-1">
                <div class="pin-digit-box" data-idx="0"></div>
                <div class="pin-digit-box" data-idx="1"></div>
                <div class="pin-digit-box" data-idx="2"></div>
                <div class="pin-digit-box" data-idx="3"></div>
                <div class="pin-digit-box" data-idx="4"></div>
                <div class="pin-digit-box" data-idx="5"></div>
            </div>

            <input type="tel" id="pin-input" class="pin-input" maxlength="6" readonly inputmode="none" tabindex="-1" autocomplete="off" style="opacity:0; position:absolute; pointer-events:none; width:1px; height:1px;">

            <div id="pin-keypad" style="display:grid; grid-template-columns:repeat(3, 1fr); gap:12px; width:100%; max-width:280px; margin-top:8px;">
                <button type="button" class="keypad-btn" data-key="1">1</button>
                <button type="button" class="keypad-btn" data-key="2">2</button>
                <button type="button" class="keypad-btn" data-key="3">3</button>
                <button type="button" class="keypad-btn" data-key="4">4</button>
                <button type="button" class="keypad-btn" data-key="5">5</button>
                <button type="button" class="keypad-btn" data-key="6">6</button>
                <button type="button" class="keypad-btn" data-key="7">7</button>
                <button type="button" class="keypad-btn" data-key="8">8</button>
                <button type="button" class="keypad-btn" data-key="9">9</button>
                <button type="button" class="keypad-btn keypad-aux" data-key="clear">C</button>
                <button type="button" class="keypad-btn" data-key="0">0</button>
                <button type="button" class="keypad-btn keypad-aux" data-key="backspace">⌫</button>
            </div>

            <p id="pin-error" style="color:var(--danger); margin-top:16px; font-weight:600; font-size:0.95rem; display:none;"></p>
        </div>
    `);

    updatePinBoxes();
    setupPinListeners();
}

function updatePinBoxes() {
    const boxes = document.querySelectorAll('.pin-digit-box');
    boxes.forEach((box, i) => {
        if (i < currentEnteredPin.length) {
            box.textContent = "•";
            box.classList.add('filled');
        } else {
            box.textContent = "";
            box.classList.remove('filled');
        }
    });
}

function setupPinListeners() {
    const hiddenInput = document.getElementById('pin-input');
    const container = document.getElementById('pin-screen-container');

    const handleDigit = (digit) => {
        if (currentEnteredPin.length < 6) {
            currentEnteredPin += digit;
            updatePinBoxes();
            if (hiddenInput) hiddenInput.value = currentEnteredPin;
            if (currentEnteredPin.length === 6) {
                submitCurrentPin();
            }
        }
    };

    const handleBackspace = () => {
        if (currentEnteredPin.length > 0) {
            currentEnteredPin = currentEnteredPin.slice(0, -1);
            updatePinBoxes();
            if (hiddenInput) hiddenInput.value = currentEnteredPin;
        }
    };

    const handleClear = () => {
        currentEnteredPin = "";
        updatePinBoxes();
        if (hiddenInput) hiddenInput.value = "";
    };

    document.querySelectorAll('.keypad-btn').forEach(btn => {
        btn.onclick = (e) => {
            e.preventDefault();
            if (btn.getAttribute('aria-disabled') === 'true') return;
            const key = btn.dataset.key;
            if (key === 'backspace') handleBackspace();
            else if (key === 'clear') handleClear();
            else if (/^\d$/.test(key)) handleDigit(key);
        };
    });

    if (hiddenInput) {
        hiddenInput.oninput = (e) => {
            currentEnteredPin = hiddenInput.value.replace(/\D/g, '').slice(0, 6);
            updatePinBoxes();
            if (currentEnteredPin.length === 6) {
                submitCurrentPin();
            }
        };
        hiddenInput.onkeydown = (e) => {
            if (e.key === 'Backspace') {
                handleBackspace();
            }
        };
    }
}

function submitCurrentPin() {
    if (currentEnteredPin.length === 6 && ws && ws.readyState === WebSocket.OPEN) {
        let deviceId = localStorage.getItem('pr_device_id') || '';
        ws.send(JSON.stringify({m: 'core', t: 'pin', d: {pin: currentEnteredPin, deviceId}}));
    }
}

function showLockedOutState(retryAfterSeconds) {
    let container = document.getElementById('pin-screen-container');
    if (!container) {
        renderPinScreen();
        container = document.getElementById('pin-screen-container');
    }

    if (lockoutTimer) { clearInterval(lockoutTimer); lockoutTimer = null; }
    if (lockoutAnnounceTimer) { clearInterval(lockoutAnnounceTimer); lockoutAnnounceTimer = null; }

    currentEnteredPin = "";
    updatePinBoxes();

    const hiddenInput = document.getElementById('pin-input');
    if (hiddenInput) {
        hiddenInput.disabled = true;
        hiddenInput.setAttribute('aria-disabled', 'true');
    }

    const boxesContainer = document.getElementById('pin-boxes');
    if (boxesContainer) {
        boxesContainer.classList.add('disabled-control');
        boxesContainer.setAttribute('aria-disabled', 'true');
    }

    const keypad = document.getElementById('pin-keypad');
    if (keypad) {
        keypad.classList.add('disabled-control');
        keypad.setAttribute('aria-disabled', 'true');
        keypad.querySelectorAll('button').forEach(btn => {
            btn.disabled = true;
            btn.setAttribute('aria-disabled', 'true');
        });
    }

    const err = document.getElementById('pin-error');
    if (err) {
        err.style.display = 'block';
    }

    const liveRegion = document.getElementById('pin-live-region');
    const startMono = performance.now();
    const durationMs = (retryAfterSeconds > 0 ? retryAfterSeconds : 1) * 1000;
    const endMono = startMono + durationMs;

    const formatMSS = (secs) => {
        const m = Math.floor(secs / 60);
        const s = secs % 60;
        return `${m}:${s.toString().padStart(2, '0')}`;
    };

    const totalSeconds = Math.max(1, retryAfterSeconds || 1);
    let initialText = `Too many wrong tries. Try again in ${formatMSS(totalSeconds)}.`;
    if (totalSeconds >= 540) {
        const mins = Math.round(totalSeconds / 60);
        initialText = `Locked for ${mins} minutes. Too many wrong tries. Try again in ${formatMSS(totalSeconds)}.`;
    }
    if (err) err.textContent = initialText;
    if (liveRegion) liveRegion.textContent = `Account locked. ${initialText}`;

    let lastAnnounce = performance.now();

    const tick = () => {
        const now = performance.now();
        const remMs = endMono - now;
        if (remMs <= 0) {
            clearInterval(lockoutTimer);
            lockoutTimer = null;
            if (lockoutAnnounceTimer) { clearInterval(lockoutAnnounceTimer); lockoutAnnounceTimer = null; }
            restorePinEntry();
            return;
        }

        const remSecs = Math.ceil(remMs / 1000);
        const txt = `Too many wrong tries. Try again in ${formatMSS(remSecs)}.`;
        if (err) err.textContent = txt;

        if (now - lastAnnounce >= 60000) {
            lastAnnounce = now;
            if (liveRegion) liveRegion.textContent = txt;
        }
    };

    lockoutTimer = setInterval(tick, 200);
}

function restorePinEntry() {
    currentEnteredPin = "";
    updatePinBoxes();

    const hiddenInput = document.getElementById('pin-input');
    if (hiddenInput) {
        hiddenInput.disabled = false;
        hiddenInput.removeAttribute('aria-disabled');
        hiddenInput.value = "";
    }

    const boxesContainer = document.getElementById('pin-boxes');
    if (boxesContainer) {
        boxesContainer.classList.remove('disabled-control');
        boxesContainer.removeAttribute('aria-disabled');
        boxesContainer.focus();
    }

    const keypad = document.getElementById('pin-keypad');
    if (keypad) {
        keypad.classList.remove('disabled-control');
        keypad.removeAttribute('aria-disabled');
        keypad.querySelectorAll('button').forEach(btn => {
            btn.disabled = false;
            btn.removeAttribute('aria-disabled');
        });
    }

    const err = document.getElementById('pin-error');
    if (err) {
        err.textContent = "";
        err.style.display = 'none';
    }

    const liveRegion = document.getElementById('pin-live-region');
    if (liveRegion) {
        liveRegion.textContent = "Lockout ended. You may now enter your PIN.";
    }
}

function connect() {
    updateStatus('reconnecting', 'Connecting...');
    
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    
    ws = new WebSocket(wsUrl);
    
    ws.onopen = () => {
        updateStatus('reconnecting', 'Authenticating...');
        currentDelay = 500;
        
        let token = localStorage.getItem('pr_token') || '';
        let deviceId = localStorage.getItem('pr_device_id') || '';
        
        ws.send(JSON.stringify({
            m: 'core',
            t: 'hello',
            d: {
                deviceId: deviceId,
                token: token,
                deviceName: navigator.userAgent
            }
        }));
    };
    
    ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        
        if (msg.m === 'core') {
            if (msg.t === 'need_pin') {
                renderPinScreen();
            } else if (msg.t === 'pending_approval') {
                showAuthOverlay(`<svg viewBox="0 0 24 24" width="48" height="48" stroke="var(--accent)" stroke-width="2" fill="none" style="margin-bottom:20px; animation: jiggle 2s infinite;"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                    <h2 style="font-size:1.5rem; font-weight:600; margin-bottom:12px;">Waiting for approval...</h2><p style="color:var(--muted);">Please accept the connection on your PC.</p>`);
            } else if (msg.t === 'paired') {
                localStorage.setItem('pr_token', msg.d.token);
                localStorage.setItem('pr_device_id', msg.d.deviceId);
                hideAuthOverlay();
                ws.send(JSON.stringify({
                    m: 'core',
                    t: 'hello',
                    d: {
                        deviceName: navigator.userAgent,
                        token: msg.d.token,
                        deviceId: msg.d.deviceId
                    }
                }));
            } else if (msg.t === 'error') {
                if (msg.d && (msg.d.type === 'bad_pin' || msg.d.code === 'bad_pin')) {
                    currentEnteredPin = "";
                    updatePinBoxes();
                    const err = document.getElementById('pin-error');
                    if (err) { err.textContent = 'Incorrect PIN'; err.style.display = 'block'; }
                    const hiddenInput = document.getElementById('pin-input');
                    if (hiddenInput) { hiddenInput.value = ""; }
                    const boxesContainer = document.getElementById('pin-boxes');
                    if (boxesContainer) { boxesContainer.focus(); }
                } else if (msg.d && (msg.d.type === 'locked_out' || msg.d.code === 'locked_out')) {
                    const retryAfter = msg.d.retryAfterSeconds !== undefined ? msg.d.retryAfterSeconds : 300;
                    showLockedOutState(retryAfter);
                } else if (msg.d && (msg.d.type === 'revoked' || msg.d.code === 'revoked')) {
                    isRevoked = true;
                    cleanup();
                    if (activeModule) {
                        closeActiveModule();
                    }
                    localStorage.removeItem('pr_token');
                    localStorage.removeItem('pr_device_id');
                    showAuthOverlay(`<svg viewBox="0 0 24 24" width="64" height="64" stroke="var(--danger)" stroke-width="2" fill="none" style="margin-bottom:20px;"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"></path><line x1="12" y1="2" x2="12" y2="12"></line></svg>
                        <h2 style="font-size:2rem; font-weight:700; margin-bottom:12px;">Device Revoked</h2><p style="color:var(--muted); font-size:1.1rem;">Please refresh the page to pair again.</p>`);
                    if (ws) {
                        try { ws.close(); } catch (e) {}
                    }
                }
            } else if (msg.t === 'ready') {
                hideAuthOverlay();
                updateStatus('connected', 'Connected');
                
                availableModules = msg.d.modules || [];
                if (msg.d.layout) {
                    currentLayout = msg.d.layout;
                    localStorage.setItem('pr_layout', JSON.stringify(currentLayout));
                } else {
                    const cached = localStorage.getItem('pr_layout');
                    if (cached) currentLayout = JSON.parse(cached);
                }
                
                if (activeModuleId) {
                    // Re-open active module on reconnect
                    ws.send(JSON.stringify({m: 'core', t: 'open', d: {module: activeModuleId}}));
                } else {
                    renderHomeScreen();
                }
                
                if (pingInterval) clearInterval(pingInterval);
                pingInterval = setInterval(() => {
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({
                            m: 'core',
                            t: 'ping',
                            i: Date.now()
                        }));
                    }
                }, 10000);
            } else if (msg.t === 'layout') {
                availableModules = msg.d.available || [];
                currentLayout = msg.d.layout || [];
                localStorage.setItem('pr_layout', JSON.stringify(currentLayout));
                if (!activeModuleId) renderHomeScreen();
            } else if (msg.t === 'pong') {
                const rtt = Date.now() - (msg.i || 0);
                updateStatus('connected', `Connected (${rtt}ms)`);
            }
        } else if (activeModuleId && msg.m === activeModuleId) {
            if (activeModuleApi && typeof activeModuleApi.on === 'function') {
                activeModuleApi.on(msg.t, msg.d);
            }
        }
    };
    
    ws.onclose = () => {
        cleanup();
        scheduleReconnect();
    };
    
    ws.onerror = (err) => {
        console.error('WebSocket error:', err);
        ws.close();
    };
}

function cleanup() {
    if (pingInterval) {
        clearInterval(pingInterval);
        pingInterval = null;
    }
}

function scheduleReconnect() {
    if (isRevoked) return;
    updateStatus('disconnected', `Reconnecting in ${currentDelay}ms...`);
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, currentDelay);
    currentDelay = Math.min(currentDelay * 2, 5000);
}

// Initial render from cache
const cached = localStorage.getItem('pr_layout');
if (cached) {
    currentLayout = JSON.parse(cached);
    renderHomeScreen();
}

connect();
