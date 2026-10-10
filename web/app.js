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

function connect() {
    updateStatus('reconnecting', 'Connecting...');
    
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    
    ws = new WebSocket(wsUrl);
    
    ws.onopen = () => {
        updateStatus('reconnecting', 'Authenticating...');
        currentDelay = 500;
        
        ws.send(JSON.stringify({
            m: 'core',
            t: 'hello',
            d: {
                deviceId: 'test_device',
                protocolVersion: 1,
                deviceName: 'Web Client'
            }
        }));
    };
    
    ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        
        if (msg.m === 'core') {
            if (msg.t === 'ready') {
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
