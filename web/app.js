import touchpad from './modules/touchpad.js';
import keyboard from './modules/keyboard.js';
import media from './modules/media.js';
import power from './modules/power.js';

const clientModules = {
    touchpad,
    keyboard,
    media,
    power
};

const statusIndicator = document.getElementById('status-indicator');
const statusText = document.getElementById('status-text');
const moduleContainer = document.getElementById('module-container');
const activeModuleContainer = document.getElementById('active-module');

let ws = null;
let reconnectTimer = null;
let pingInterval = null;
let currentDelay = 500;
let activeModule = null;
let activeModuleApi = null;

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
                // Send hello again with the new token
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
                
                moduleContainer.innerHTML = '';
                msg.d.modules.forEach(mInfo => {
                    if (clientModules[mInfo.id]) {
                        const btn = document.createElement('button');
                        btn.textContent = `Open ${mInfo.name}`;
                        btn.style.margin = '5px';
                        btn.style.padding = '10px';
                        btn.onclick = () => openModule(mInfo.id);
                        moduleContainer.appendChild(btn);
                    }
                });
                
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
            } else if (msg.t === 'pong') {
                const rtt = Date.now() - (msg.i || 0);
                updateStatus('connected', `Connected (${rtt}ms)`);
            }
        } else if (activeModule && msg.m === activeModule.id) {
            if (typeof activeModuleApi.on === 'function') {
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

function openModule(id) {
    if (activeModule) {
        activeModule.unmount();
        ws.send(JSON.stringify({m: 'core', t: 'close', d: {module: activeModule.id}}));
        activeModuleContainer.innerHTML = '';
    }
    
    const mod = clientModules[id];
    activeModule = mod;
    ws.send(JSON.stringify({m: 'core', t: 'open', d: {module: id}}));
    
    activeModuleApi = {
        send: (type, data) => {
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({m: id, t: type, d: data}));
            }
        },
        on: null // Can be overridden by the module
    };
    
    mod.mount(activeModuleContainer, activeModuleApi);
}

function cleanup() {
    if (pingInterval) {
        clearInterval(pingInterval);
        pingInterval = null;
    }
    if (activeModule) {
        activeModule.unmount();
        activeModule = null;
    }
    moduleContainer.innerHTML = '';
    activeModuleContainer.innerHTML = '';
}

function scheduleReconnect() {
    updateStatus('disconnected', `Reconnecting in ${currentDelay}ms...`);
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, currentDelay);
    currentDelay = Math.min(currentDelay * 2, 5000);
}

connect();
