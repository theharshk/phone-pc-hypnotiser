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
    header.style.marginBottom = '15px';
    
    const editBtn = document.createElement('button');
    editBtn.textContent = isEditMode ? 'Done' : 'Edit';
    editBtn.onclick = () => {
        isEditMode = !isEditMode;
        renderHomeScreen();
    };
    header.appendChild(editBtn);
    moduleContainer.appendChild(header);

    // Render tiles
    currentLayout.forEach((modId, index) => {
        const modInfo = availableModules.find(m => m.id === modId) || { id: modId, name: modId };
        
        const tile = document.createElement('div');
        tile.style.border = '1px solid #ccc';
        tile.style.padding = '15px';
        tile.style.margin = '5px 0';
        tile.style.borderRadius = '5px';
        tile.style.display = 'flex';
        tile.style.justifyContent = 'space-between';
        tile.style.alignItems = 'center';

        const nameSpan = document.createElement('span');
        nameSpan.textContent = modInfo.name;
        nameSpan.style.cursor = isEditMode ? 'default' : 'pointer';
        nameSpan.style.flexGrow = '1';
        if (!isEditMode) {
            nameSpan.onclick = () => openModule(modId);
        }
        tile.appendChild(nameSpan);

        if (isEditMode) {
            const controls = document.createElement('div');
            
            if (index > 0) {
                const upBtn = document.createElement('button');
                upBtn.textContent = 'Up';
                upBtn.onclick = () => {
                    [currentLayout[index - 1], currentLayout[index]] = [currentLayout[index], currentLayout[index - 1]];
                    saveLayout();
                    renderHomeScreen();
                };
                controls.appendChild(upBtn);
            }
            if (index < currentLayout.length - 1) {
                const downBtn = document.createElement('button');
                downBtn.textContent = 'Down';
                downBtn.onclick = () => {
                    [currentLayout[index + 1], currentLayout[index]] = [currentLayout[index], currentLayout[index + 1]];
                    saveLayout();
                    renderHomeScreen();
                };
                controls.appendChild(downBtn);
            }
            
            const rmBtn = document.createElement('button');
            rmBtn.textContent = 'Remove';
            rmBtn.style.color = 'red';
            rmBtn.onclick = () => {
                currentLayout.splice(index, 1);
                saveLayout();
                renderHomeScreen();
            };
            controls.appendChild(rmBtn);
            
            tile.appendChild(controls);
        }

        moduleContainer.appendChild(tile);
    });

    if (isEditMode) {
        const unadded = availableModules.filter(m => !currentLayout.includes(m.id));
        if (unadded.length > 0) {
            const addSelect = document.createElement('select');
            addSelect.innerHTML = '<option value="">-- Add a remote --</option>';
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

async function openModule(id) {
    if (activeModule) {
        activeModule.unmount();
        ws.send(JSON.stringify({m: 'core', t: 'close', d: {module: activeModuleId}}));
        activeModuleContainer.innerHTML = '';
    }
    
    moduleContainer.style.display = 'none';
    activeModuleContainer.style.display = 'block';
    
    const backBtn = document.createElement('button');
    backBtn.textContent = 'Back';
    backBtn.style.marginBottom = '10px';
    backBtn.onclick = () => {
        if (activeModule) {
            activeModule.unmount();
            ws.send(JSON.stringify({m: 'core', t: 'close', d: {module: activeModuleId}}));
        }
        activeModule = null;
        activeModuleId = null;
        activeModuleContainer.innerHTML = '';
        renderHomeScreen();
    };
    activeModuleContainer.appendChild(backBtn);

    const modContainer = document.createElement('div');
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
            on: null
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
                    <h2>Enter PIN</h2>
                    <input type="tel" id="pin-input" maxlength="6" style="font-size:24px; letter-spacing:10px; width:200px; text-align:center; padding:10px; border-radius:5px; border:none; margin-bottom: 20px;">
                    <br>
                    <button id="pin-submit" style="padding:10px 20px; font-size:18px; border-radius:5px; border:none; background:#2196f3; color:white;">Submit</button>
                    <p id="pin-error" style="color:#f44336; margin-top:10px; display:none;"></p>
                `);
                document.getElementById('pin-submit').onclick = () => {
                    const pin = document.getElementById('pin-input').value;
                    if (pin.length === 6) {
                        let deviceId = localStorage.getItem('pr_device_id') || '';
                        ws.send(JSON.stringify({m: 'core', t: 'pin', d: {pin, deviceId}}));
                    }
                };
            } else if (msg.t === 'pending_approval') {
                showAuthOverlay(`<h2>Waiting for approval on the laptop...</h2><p>Please check your PC terminal.</p>`);
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
                    showAuthOverlay(`<h2 style="color:#f44336;">Locked Out</h2><p>Too many attempts. Try again later.</p>`);
                } else if (msg.d.type === 'revoked') {
                    localStorage.removeItem('pr_token');
                    localStorage.removeItem('pr_device_id');
                    showAuthOverlay(`<h2>Device Revoked</h2><p>Please refresh the page to pair again.</p>`);
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
