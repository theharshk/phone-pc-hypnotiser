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

function updateStatus(state, text) {
    statusIndicator.className = state;
    statusText.textContent = text;
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
    
    headerBar.appendChild(backBtn);
    headerBar.appendChild(title);
    activeModuleContainer.appendChild(headerBar);

    const modContainer = document.createElement('div');
    modContainer.style.cssText = 'flex:1; width:100%; position:relative; overflow:auto;';
    activeModuleContainer.appendChild(modContainer);

    try {
        if (!loadedModules[id]) {
            const module = await import('./modules/' + id + '.js');
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
                showAuthOverlay(`
                    <h2 style="font-size:2rem; font-weight:700; margin-bottom:12px;">Enter PIN</h2>
                    <p style="color:var(--muted); margin-bottom:32px;">Please enter the 6-digit PIN displayed on your PC.</p>
                    <input type="tel" id="pin-input" class="pin-input" maxlength="6" placeholder="••••••">
                    <button id="pin-submit" style="margin-top:24px; width:80%; max-width:300px; padding:18px; font-size:1.2rem; font-weight:700; border-radius:16px; background:white; color:black; border:none; box-shadow:0 8px 24px rgba(255,255,255,0.2);">Connect</button>
                    <p id="pin-error" style="color:var(--danger); margin-top:20px; font-weight:600; display:none;"></p>
                `);
                
                const pinInput = document.getElementById('pin-input');
                pinInput.focus();
                
                const submitPin = () => {
                    const pin = pinInput.value;
                    if (pin.length === 6) {
                        let deviceId = localStorage.getItem('pr_device_id') || '';
                        ws.send(JSON.stringify({m: 'core', t: 'pin', d: {pin, deviceId}}));
                    } else {
                        document.getElementById('pin-error').textContent = 'PIN must be 6 digits';
                        document.getElementById('pin-error').style.display = 'block';
                    }
                };
                
                document.getElementById('pin-submit').onclick = submitPin;
                pinInput.onkeyup = (e) => {
                    if (e.key === 'Enter') submitPin();
                };
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
                if (msg.d.type === 'bad_pin') {
                    const err = document.getElementById('pin-error');
                    if (err) { err.textContent = 'Incorrect PIN'; err.style.display = 'block'; }
                } else if (msg.d.type === 'locked_out') {
                    showAuthOverlay(`<svg viewBox="0 0 24 24" width="64" height="64" stroke="var(--danger)" stroke-width="2" fill="none" style="margin-bottom:20px;"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
                        <h2 style="font-size:2rem; font-weight:700; color:var(--danger); margin-bottom:12px;">Locked Out</h2><p style="color:var(--muted); font-size:1.1rem;">Too many attempts. Try again later.</p>`);
                } else if (msg.d.type === 'revoked') {
                    localStorage.removeItem('pr_token');
                    localStorage.removeItem('pr_device_id');
                    showAuthOverlay(`<svg viewBox="0 0 24 24" width="64" height="64" stroke="var(--danger)" stroke-width="2" fill="none" style="margin-bottom:20px;"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"></path><line x1="12" y1="2" x2="12" y2="12"></line></svg>
                        <h2 style="font-size:2rem; font-weight:700; margin-bottom:12px;">Device Revoked</h2><p style="color:var(--muted); font-size:1.1rem;">Please refresh the page to pair again.</p>`);
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
