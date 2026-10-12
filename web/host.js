// web/host.js - Phone Remote Controller Client
// Aligned with DESIGN.md Section 6.5 & Section 21

// UI Elements
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const deviceTitle = document.getElementById('device-title');
const homeView = document.getElementById('home-view');
const settingsView = document.getElementById('settings-view');
const activeModuleContainer = document.getElementById('active-module');
const moonBtn = document.getElementById('moon-btn');
const editBtn = document.getElementById('edit-btn');
const settingsBtn = document.getElementById('settings-btn');

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
let isAuthenticated = false;

// --------------------------------------------------------------------------
// Safe LocalStorage Helper
// --------------------------------------------------------------------------
function safeStorageGet(key, fallback = null) {
    try {
        const val = localStorage.getItem(key);
        return val !== null ? val : fallback;
    } catch (e) {
        return fallback;
    }
}

function safeStorageSet(key, value) {
    try {
        localStorage.setItem(key, value);
    } catch (e) {}
}

function safeStorageRemove(key) {
    try {
        localStorage.removeItem(key);
    } catch (e) {}
}

function generateDeviceId() {
    try {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
            return crypto.randomUUID();
        }
    } catch (e) {}
    return 'dev-' + Math.random().toString(36).substring(2, 15) + '-' + Date.now().toString(36);
}

// Stable Client ID: persist immediately on script load if missing or empty
let clientDeviceId = safeStorageGet('pr_device_id');
if (!clientDeviceId) {
    clientDeviceId = generateDeviceId();
    safeStorageSet('pr_device_id', clientDeviceId);
}

// --------------------------------------------------------------------------
// Settings State & Haptics
// --------------------------------------------------------------------------
let userTheme = safeStorageGet('pr_theme', 'dark');
let isBedside = safeStorageGet('pr_bedside', 'false') === 'true';
let hapticsEnabled = safeStorageGet('pr_haptics', 'true') === 'true';
let touchpadSpeed = parseFloat(safeStorageGet('pr_touchpad_speed', '1.0')) || 1.0;
let streamSpeed = safeStorageGet('pr_stream_speed', 'turbo');

function triggerHaptic(duration = 35) {
    if (!hapticsEnabled) return;
    try {
        if (typeof navigator !== 'undefined' && navigator.vibrate) {
            navigator.vibrate(duration);
        }
    } catch (e) {}
}
if (typeof window !== 'undefined') {
    window.__pr_triggerHaptic = triggerHaptic;
}

function updateThemeIcon(effective) {
    if (!moonBtn) return;
    if (effective === 'light') {
        moonBtn.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>`;
        moonBtn.setAttribute('aria-label', 'Switch to dark theme');
        moonBtn.setAttribute('title', 'Switch to dark theme');
    } else {
        moonBtn.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>`;
        moonBtn.setAttribute('aria-label', 'Switch to light theme');
        moonBtn.setAttribute('title', 'Switch to light theme');
    }
}

function applyTheme(themeChoice) {
    userTheme = themeChoice;
    safeStorageSet('pr_theme', userTheme);
    let effective = userTheme;
    if (userTheme === 'system') {
        effective = (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) ? 'light' : 'dark';
    }
    document.documentElement.setAttribute('data-theme', effective);
    updateThemeIcon(effective);
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) {
        metaTheme.setAttribute('content', effective === 'light' ? '#E8EBF0' : '#05070B');
    }
}

function applyBedside(enable) {
    isBedside = enable;
    safeStorageSet('pr_bedside', isBedside ? 'true' : 'false');
    if (isBedside) {
        document.documentElement.setAttribute('data-bedside', 'true');
    } else {
        document.documentElement.removeAttribute('data-bedside');
    }
}

// Apply initial settings
applyTheme(userTheme);
applyBedside(isBedside);

if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
        if (userTheme === 'system') applyTheme('system');
    });
}

// --------------------------------------------------------------------------
// Status Line & Indicators
// --------------------------------------------------------------------------
function updateStatus(state, text) {
    if (statusDot) {
        statusDot.className = 'status-dot ' + state;
    }
    if (statusText) {
        statusText.textContent = text;
    }
    const dot = document.getElementById('module-status-dot');
    if (dot) {
        dot.className = 'status-dot ' + state;
    }
}

// --------------------------------------------------------------------------
// Auth & Locked/Revoked Overlays
// --------------------------------------------------------------------------
const authOverlay = document.createElement('div');
authOverlay.id = 'auth-overlay';
authOverlay.className = 'glass-overlay';
authOverlay.style.display = 'none';
document.body.appendChild(authOverlay);

function showAuthOverlay(html) {
    authOverlay.innerHTML = html;
    authOverlay.style.display = 'flex';
}

function hideAuthOverlay() {
    authOverlay.style.display = 'none';
}

function showConfirmDialog({ title, message, confirmText, isDanger = false, onConfirm }) {
    triggerHaptic(20);
    const dangerStyle = isDanger ? 'style="background:var(--danger); color:#FFFFFF;"' : '';
    showAuthOverlay(`
        <div class="auth-card" style="max-width:320px;">
            <h3 class="heading" style="font-size:clamp(20px, 5.5vw, 24px); margin-bottom:8px;">${title}</h3>
            <p style="color:var(--muted); font-size:clamp(13px, 3.5vw, 15px); margin-bottom:20px;">${message}</p>
            <div style="width:100%; display:flex; flex-direction:column; gap:10px;">
                <button id="modal-confirm-btn" class="pill-btn-primary" ${dangerStyle}>${confirmText}</button>
                <button id="modal-cancel-btn" class="pill-btn-outline" style="width:100%;">Cancel</button>
            </div>
        </div>
    `);

    const confirmBtn = document.getElementById('modal-confirm-btn');
    const cancelBtn = document.getElementById('modal-cancel-btn');

    if (confirmBtn) {
        confirmBtn.onclick = () => {
            triggerHaptic(25);
            hideAuthOverlay();
            if (typeof onConfirm === 'function') onConfirm();
        };
    }
    if (cancelBtn) {
        cancelBtn.onclick = () => {
            triggerHaptic(15);
            hideAuthOverlay();
        };
    }
}

// --------------------------------------------------------------------------
// Router (Section 6.5)
// --------------------------------------------------------------------------
window.addEventListener('hashchange', () => {
    const route = window.location.hash.replace(/^#/, '');
    renderRoute(route);
});

function renderRoute(route) {
    // If not authenticated, overlay is active. Still sync views underneath.
    if (!route || route === 'home') {
        if (activeModule) {
            activeModule.unmount();
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({m: 'core', t: 'close', d: {module: activeModuleId}}));
            }
            activeModule = null;
            activeModuleId = null;
        }
        homeView.style.display = 'block';
        settingsView.style.display = 'none';
        activeModuleContainer.style.display = 'none';
        activeModuleContainer.innerHTML = '';
        renderHomeScreen();
    } else if (route === 'settings') {
        if (activeModule) {
            activeModule.unmount();
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({m: 'core', t: 'close', d: {module: activeModuleId}}));
            }
            activeModule = null;
            activeModuleId = null;
        }
        homeView.style.display = 'none';
        settingsView.style.display = 'block';
        activeModuleContainer.style.display = 'none';
        activeModuleContainer.innerHTML = '';
        renderSettingsScreen();
    } else {
        // Module route
        homeView.style.display = 'none';
        settingsView.style.display = 'none';
        activeModuleContainer.style.display = 'flex';
        openModule(route);
    }
}

// --------------------------------------------------------------------------
// Header Action Listeners
// --------------------------------------------------------------------------
if (moonBtn) {
    moonBtn.onclick = () => {
        triggerHaptic(30);
        const currentEffective = document.documentElement.getAttribute('data-theme') || userTheme;
        const nextTheme = currentEffective === 'dark' ? 'light' : 'dark';
        applyTheme(nextTheme);
        const segBtns = document.querySelectorAll('.seg-btn');
        if (segBtns.length > 0) {
            segBtns.forEach(b => {
                if (b.dataset.val === nextTheme) b.classList.add('active');
                else b.classList.remove('active');
            });
        }
    };
}

if (editBtn) {
    editBtn.onclick = () => {
        triggerHaptic(10);
        isEditMode = !isEditMode;
        editBtn.textContent = isEditMode ? 'Done' : 'Edit';
        if (isEditMode) document.body.classList.add('edit-mode');
        else document.body.classList.remove('edit-mode');
        renderHomeScreen();
    };
}

if (settingsBtn) {
    settingsBtn.onclick = () => {
        triggerHaptic(10);
        window.location.hash = '#settings';
    };
}

// --------------------------------------------------------------------------
// Module Icons (Clean Inline SVGs, accent-text color)
// --------------------------------------------------------------------------
const moduleIcons = {
    'touchpad': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"></rect><line x1="4" y1="12" x2="20" y2="12"></line><line x1="12" y1="12" x2="12" y2="20"></line></svg>`,
    'keyboard': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"></rect><path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M8 12h.01M12 12h.01M16 12h.01M7 16h10"></path></svg>`,
    'media': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>`,
    'power': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"></path><line x1="12" y1="2" x2="12" y2="12"></line></svg>`,
    'screen': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>`
};

const moduleDescriptions = {
    'touchpad': 'Cursor, clicks & gestures',
    'keyboard': 'Typing & special keys',
    'media': 'Volume & playback controls',
    'power': 'Sleep, restart & shutdown',
    'screen': 'Live desktop view & taps'
};

// --------------------------------------------------------------------------
// Quick Actions (Mute, Lock, Sleep)
// --------------------------------------------------------------------------
function executeQuickMute() {
    triggerHaptic(15);
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({m: 'media', t: 'action', d: {key: 'MUTE'}}));
    }
}

function executeQuickLock() {
    triggerHaptic(15);
    if (ws && ws.readyState === WebSocket.OPEN) {
        const handler = (event) => {
            try {
                const msg = JSON.parse(event.data);
                if (msg.m === 'power' && msg.t === 'token' && msg.d && msg.d.action === 'LOCK') {
                    ws.removeEventListener('message', handler);
                    ws.send(JSON.stringify({m: 'power', t: 'execute', d: {action: 'LOCK', token: msg.d.token}}));
                }
            } catch (e) {}
        };
        ws.addEventListener('message', handler);
        ws.send(JSON.stringify({m: 'power', t: 'request', d: {action: 'LOCK'}}));
    }
}

function executeQuickSleep() {
    triggerHaptic(15);
    // Request token and execute confirmation flow
    if (ws && ws.readyState === WebSocket.OPEN) {
        const handler = (event) => {
            try {
                const msg = JSON.parse(event.data);
                if (msg.m === 'power' && msg.t === 'token' && msg.d && msg.d.action === 'SLEEP') {
                    ws.removeEventListener('message', handler);
                    ws.send(JSON.stringify({m: 'power', t: 'execute', d: {action: 'SLEEP', token: msg.d.token}}));
                }
            } catch (e) {}
        };
        ws.addEventListener('message', handler);
        ws.send(JSON.stringify({m: 'power', t: 'request', d: {action: 'SLEEP'}}));
    }
}

// --------------------------------------------------------------------------
// Home Screen Rendering
// --------------------------------------------------------------------------
function renderHomeScreen() {
    homeView.innerHTML = '';

    // Quick Actions Row
    const quickRow = document.createElement('div');
    quickRow.className = 'quick-actions-row';

    const muteBtn = document.createElement('button');
    muteBtn.className = 'quick-action-btn';
    muteBtn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg>
        <span>Mute</span>
    `;
    muteBtn.onclick = executeQuickMute;

    const lockBtn = document.createElement('button');
    lockBtn.className = 'quick-action-btn';
    lockBtn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
        <span>Lock</span>
    `;
    lockBtn.onclick = () => {
        triggerHaptic(20);
        showConfirmDialog({
            title: 'Lock PC?',
            message: 'Are you sure you want to lock the workstation?',
            confirmText: 'Lock',
            onConfirm: executeQuickLock
        });
    };

    const sleepBtn = document.createElement('button');
    sleepBtn.className = 'quick-action-btn';
    sleepBtn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>
        <span>Sleep</span>
    `;
    sleepBtn.onclick = () => {
        triggerHaptic(20);
        showConfirmDialog({
            title: 'Sleep PC?',
            message: 'Are you sure you want to put your computer to sleep?',
            confirmText: 'Sleep',
            onConfirm: executeQuickSleep
        });
    };

    quickRow.appendChild(muteBtn);
    quickRow.appendChild(lockBtn);
    quickRow.appendChild(sleepBtn);
    homeView.appendChild(quickRow);

    // 2-Column Module Grid (Equal fills, equal radius 22px)
    const grid = document.createElement('div');
    grid.className = 'grid-container';

    currentLayout.forEach((modId, index) => {
        const modInfo = availableModules.find(m => m.id === modId) || { id: modId, name: modId };
        const tile = document.createElement('div');
        tile.className = 'module-tile';

        const iconSvg = moduleIcons[modId] || `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>`;
        const desc = moduleDescriptions[modId] || 'Remote control module';

        tile.innerHTML = `
            <div class="tile-icon">${iconSvg}</div>
            <div class="tile-name">${modInfo.name}</div>
            <div class="tile-desc">${desc}</div>
        `;

        if (!isEditMode) {
            tile.onclick = () => {
                triggerHaptic(10);
                window.location.hash = '#' + modId;
            };
        } else {
            // Edit controls (remove, move up, move down)
            const editBar = document.createElement('div');
            editBar.className = 'tile-edit-bar';

            if (index > 0) {
                const upBtn = document.createElement('button');
                upBtn.className = 'tile-edit-btn';
                upBtn.innerHTML = '↑';
                upBtn.onclick = (e) => {
                    e.stopPropagation();
                    const item = currentLayout.splice(index, 1)[0];
                    currentLayout.splice(index - 1, 0, item);
                    saveLayout();
                    renderHomeScreen();
                };
                editBar.appendChild(upBtn);
            }

            if (index < currentLayout.length - 1) {
                const downBtn = document.createElement('button');
                downBtn.className = 'tile-edit-btn';
                downBtn.innerHTML = '↓';
                downBtn.onclick = (e) => {
                    e.stopPropagation();
                    const item = currentLayout.splice(index, 1)[0];
                    currentLayout.splice(index + 1, 0, item);
                    saveLayout();
                    renderHomeScreen();
                };
                editBar.appendChild(downBtn);
            }

            const delBtn = document.createElement('button');
            delBtn.className = 'tile-edit-btn delete';
            delBtn.innerHTML = '✕';
            delBtn.onclick = (e) => {
                e.stopPropagation();
                currentLayout.splice(index, 1);
                saveLayout();
                renderHomeScreen();
            };
            editBar.appendChild(delBtn);

            tile.appendChild(editBar);
        }

        grid.appendChild(tile);
    });

    homeView.appendChild(grid);

    // Add a Remote (Dashed Button)
    const unadded = availableModules.filter(m => !currentLayout.includes(m.id));
    if (unadded.length > 0) {
        const addBtn = document.createElement('button');
        addBtn.className = 'add-remote-btn';
        addBtn.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg> Add a remote`;
        addBtn.onclick = () => {
            triggerHaptic(10);
            showAddModulePicker(unadded);
        };
        homeView.appendChild(addBtn);
    }
}

function showAddModulePicker(unadded) {
    const listHtml = unadded.map(m => `
        <button class="pill-btn-outline add-item-btn" data-id="${m.id}" style="width:100%; justify-content:flex-start; gap:12px; margin-bottom:8px; padding:12px 16px;">
            ${m.name}
        </button>
    `).join('');

    showAuthOverlay(`
        <div class="auth-card" style="max-width:320px;">
            <h3 style="margin-bottom:16px;">Add Remote</h3>
            <div style="width:100%; display:flex; flex-direction:column; margin-bottom:16px;">
                ${listHtml}
            </div>
            <button id="close-add-modal" class="pill-btn-outline" style="width:100%;">Cancel</button>
        </div>
    `);

    document.querySelectorAll('.add-item-btn').forEach(b => {
        b.onclick = () => {
            currentLayout.push(b.dataset.id);
            saveLayout();
            hideAuthOverlay();
            renderHomeScreen();
        };
    });

    const closeBtn = document.getElementById('close-add-modal');
    if (closeBtn) closeBtn.onclick = hideAuthOverlay;
}

function saveLayout() {
    safeStorageSet('pr_layout', JSON.stringify(currentLayout));
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({m: 'core', t: 'set_layout', d: {layout: currentLayout}}));
    }
}

// --------------------------------------------------------------------------
// Settings Screen Rendering
// --------------------------------------------------------------------------
function renderSettingsScreen() {
    settingsView.innerHTML = `
        <div class="settings-header">
            <button id="settings-back-btn" class="pill-btn-outline" aria-label="Back to home">
                <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none"><polyline points="15 18 9 12 15 6"></polyline></svg>
                <span style="margin-left:4px;">Back</span>
            </button>
            <h2 class="settings-title">Settings</h2>
        </div>

        <div class="settings-group">
            <div class="settings-group-title">Appearance</div>
            <div class="settings-row">
                <div class="settings-label">
                    <span class="settings-name">Theme</span>
                    <span class="settings-subtext">Dark, Light, or follow system</span>
                </div>
                <div class="segmented-control">
                    <button class="seg-btn ${userTheme === 'dark' ? 'active' : ''}" data-val="dark">Dark</button>
                    <button class="seg-btn ${userTheme === 'light' ? 'active' : ''}" data-val="light">Light</button>
                    <button class="seg-btn ${userTheme === 'system' ? 'active' : ''}" data-val="system">System</button>
                </div>
            </div>
            <div class="settings-row">
                <div class="settings-label">
                    <span class="settings-name">Bedside Mode</span>
                    <span class="settings-subtext">Dims screen, mutes accents, disables glass</span>
                </div>
                <label class="switch">
                    <input type="checkbox" id="bedside-toggle" ${isBedside ? 'checked' : ''}>
                    <span class="slider"></span>
                </label>
            </div>
        </div>

        <div class="settings-group">
            <div class="settings-group-title">Touch and Feedback</div>
            <div class="settings-row">
                <div class="settings-label">
                    <span class="settings-name">Haptic Feedback</span>
                    <span class="settings-subtext">Subtle vibration on interactions</span>
                </div>
                <label class="switch">
                    <input type="checkbox" id="haptics-toggle" ${hapticsEnabled ? 'checked' : ''}>
                    <span class="slider"></span>
                </label>
            </div>
            <div class="settings-row">
                <div class="settings-label">
                    <span class="settings-name">Touchpad Speed</span>
                    <span class="settings-subtext">Sensitivity multiplier</span>
                </div>
                <input type="range" id="speed-slider" class="speed-slider" min="0.5" max="2.0" step="0.1" value="${touchpadSpeed}">
            </div>
            <div class="settings-row">
                <div class="settings-label">
                    <span class="settings-name">Streaming Typing Speed</span>
                    <span class="settings-subtext">Clipboard paste speed to PC</span>
                </div>
                <select id="stream-speed-select" class="pill-btn-outline" style="padding:6px 10px; min-height:38px; border-radius:12px; background:var(--card-alt); color:var(--text); font-weight:600; font-size:0.85rem; outline:none; border:1px solid var(--border);">
                    <option value="turbo" ${streamSpeed === 'turbo' ? 'selected' : ''}>Turbo (~2,200 WPM) [Default]</option>
                    <option value="world_record" ${streamSpeed === 'world_record' ? 'selected' : ''}>World Record Typist (~215 WPM)</option>
                    <option value="pro" ${streamSpeed === 'pro' ? 'selected' : ''}>Pro Typist (~120 WPM)</option>
                    <option value="fast" ${streamSpeed === 'fast' ? 'selected' : ''}>Fast Typist (~75 WPM)</option>
                    <option value="human" ${streamSpeed === 'human' ? 'selected' : ''}>Average Human (~55 WPM)</option>
                </select>
            </div>
            <div class="settings-row" style="flex-direction:column; align-items:flex-start; gap:8px;">
                <div style="display:flex; justify-content:space-between; align-items:center; width:100%;">
                    <div class="settings-label">
                        <span class="settings-name">Test Haptics</span>
                        <span class="settings-subtext">Diagnose device vibration support</span>
                    </div>
                    <button id="test-haptics-btn" class="pill-btn-outline" style="padding:6px 14px; min-height:36px;">Test</button>
                </div>
                <div id="haptics-diag-info" class="settings-subtext mono" style="font-size:11px; word-break:break-all; width:100%; display:none; background:var(--card-alt); padding:8px 10px; border-radius:8px; border:1px solid var(--border); margin-top:4px;"></div>
                <div class="settings-subtext" style="font-size:11px; color:var(--muted); margin-top:2px;">
                    Note: If no vibration is felt, check your phone's Android <strong>Settings → Sound & vibration → Touch / Haptic feedback</strong> (if disabled in Android, Chrome silently suppresses vibration).
                </div>
            </div>
        </div>

        <div class="settings-group">
            <div class="settings-group-title">Connection</div>
            <div class="settings-row">
                <div class="settings-label">
                    <span class="settings-name">Server Address</span>
                    <span class="settings-subtext mono">${window.location.host || '127.0.0.1:8080'}</span>
                </div>
            </div>
        </div>

        <div class="settings-group">
            <div class="settings-group-title">Session</div>
            <div class="settings-row">
                <div class="settings-label">
                    <span class="settings-name">Disconnect & Forget</span>
                    <span class="settings-subtext">Forget pairing and return to PIN screen</span>
                </div>
                <button id="logout-btn" class="pill-btn-outline" style="color:var(--danger); border-color:var(--danger);">Disconnect</button>
            </div>
        </div>
    `;

    const backBtn = document.getElementById('settings-back-btn');
    if (backBtn) {
        backBtn.onclick = () => {
            triggerHaptic(20);
            window.location.hash = '#home';
        };
    }

    // Theme selector
    settingsView.querySelectorAll('.seg-btn').forEach(btn => {
        btn.onclick = () => {
            triggerHaptic(10);
            settingsView.querySelectorAll('.seg-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            applyTheme(btn.dataset.val);
        };
    });

    // Bedside switch
    const bedsideToggle = document.getElementById('bedside-toggle');
    if (bedsideToggle) {
        bedsideToggle.onchange = () => {
            triggerHaptic(10);
            applyBedside(bedsideToggle.checked);
        };
    }

    // Haptics switch
    const hapticsToggle = document.getElementById('haptics-toggle');
    if (hapticsToggle) {
        hapticsToggle.onchange = () => {
            hapticsEnabled = hapticsToggle.checked;
            safeStorageSet('pr_haptics', hapticsEnabled ? 'true' : 'false');
            triggerHaptic(15);
        };
    }

    // Touchpad speed
    const speedSlider = document.getElementById('speed-slider');
    if (speedSlider) {
        speedSlider.oninput = () => {
            touchpadSpeed = parseFloat(speedSlider.value) || 1.0;
            safeStorageSet('pr_touchpad_speed', touchpadSpeed.toString());
        };
    }

    // Streaming typing speed
    const streamSpeedSelect = document.getElementById('stream-speed-select');
    if (streamSpeedSelect) {
        streamSpeedSelect.onchange = () => {
            streamSpeed = streamSpeedSelect.value || 'turbo';
            safeStorageSet('pr_stream_speed', streamSpeed);
            triggerHaptic(10);
        };
    }

    // Test Haptics diagnostic button
    const testHapticsBtn = document.getElementById('test-haptics-btn');
    const hapticsDiag = document.getElementById('haptics-diag-info');
    if (testHapticsBtn && hapticsDiag) {
        testHapticsBtn.onclick = () => {
            const supported = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
            let result = false;
            if (supported) {
                try {
                    result = navigator.vibrate([40, 60, 40]);
                } catch (e) {
                    result = false;
                }
            }
            const isSecure = typeof window !== 'undefined' && window.isSecureContext;
            hapticsDiag.style.display = 'block';
            hapticsDiag.innerHTML = `Vibration API: <b>${supported ? 'Supported' : 'Not supported'}</b><br>` +
                `Dispatched: <b>${result ? 'True (Vibrated)' : 'False (Suppressed by OS/browser)'}</b><br>` +
                `Secure Context: <b>${isSecure ? 'Yes (HTTPS/Localhost)' : 'No (HTTP LAN IP)'}</b>`;
        };
    }

    // Logout / Disconnect
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.onclick = () => {
            triggerHaptic(20);
            showConfirmDialog({
                title: 'Disconnect PC?',
                message: 'Are you sure you want to forget this device and log out?',
                confirmText: 'Disconnect',
                isDanger: true,
                onConfirm: () => {
                    const deviceId = safeStorageGet('pr_device_id');
                    if (ws && ws.readyState === WebSocket.OPEN) {
                        try {
                            ws.send(JSON.stringify({
                                m: 'core',
                                t: 'unpair',
                                d: { deviceId: deviceId || '' }
                            }));
                        } catch (e) {}
                    }
                    safeStorageRemove('pr_token');
                    safeStorageRemove('pr_device_id');
                    safeStorageRemove('pr_layout');
                    isAuthenticated = false;
                    if (ws) {
                        try { ws.close(); } catch (e) {}
                    }
                    if (window.location.hash) {
                        window.history.replaceState(null, '', window.location.pathname);
                    }
                    renderPinScreen();
                }
            });
        };
    }
}

// --------------------------------------------------------------------------
// Module Loading & Active View
// --------------------------------------------------------------------------
async function openModule(id) {
    if (activeModule) {
        activeModule.unmount();
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({m: 'core', t: 'close', d: {module: activeModuleId}}));
        }
        activeModule = null;
        activeModuleId = null;
    }

    activeModuleContainer.innerHTML = '';

    const headerBar = document.createElement('div');
    headerBar.className = 'module-header-bar';

    const backBtn = document.createElement('button');
    backBtn.className = 'module-back-btn';
    backBtn.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none"><polyline points="15 18 9 12 15 6"></polyline></svg> Back`;
    backBtn.onclick = () => {
        triggerHaptic(20);
        window.location.hash = '#home';
    };

    const title = document.createElement('span');
    title.className = 'module-header-title';
    title.textContent = availableModules.find(m => m.id === id)?.name || id;

    const statusDotEl = document.createElement('span');
    statusDotEl.id = 'module-status-dot';
    statusDotEl.className = statusDot ? statusDot.className : 'status-dot disconnected';

    headerBar.appendChild(backBtn);
    headerBar.appendChild(title);
    headerBar.appendChild(statusDotEl);
    activeModuleContainer.appendChild(headerBar);

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
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({m: 'core', t: 'open', d: {module: id}}));
        }

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

// --------------------------------------------------------------------------
// Pairing Screen & Locked Out Logic (Strict fit-the-phone & keyboard block)
// --------------------------------------------------------------------------
let lockoutTimer = null;
let currentEnteredPin = "";

function renderPinScreen() {
    currentEnteredPin = "";
    if (lockoutTimer) { clearInterval(lockoutTimer); lockoutTimer = null; }

    showAuthOverlay(`
        <div class="auth-card" id="pin-screen-container">
            <div id="pin-live-region" class="sr-only" aria-live="polite" aria-atomic="true"></div>
            <h2 id="pin-screen-title" class="heading" style="font-size:clamp(24px, 7vw, 30px); margin-bottom:8px;">Pair this phone</h2>
            <p id="pin-screen-subtitle" style="color:var(--muted); margin-bottom:20px; font-size:clamp(13px, 3.5vw, 15px);">Enter the 6-digit PIN displayed on your PC.</p>
            
            <div id="pin-boxes" class="pin-boxes-container" aria-label="PIN digits" tabindex="-1">
                <div class="pin-digit-box" data-idx="0"></div>
                <div class="pin-digit-box" data-idx="1"></div>
                <div class="pin-digit-box" data-idx="2"></div>
                <div class="pin-digit-box" data-idx="3"></div>
                <div class="pin-digit-box" data-idx="4"></div>
                <div class="pin-digit-box" data-idx="5"></div>
            </div>

            <input type="tel" id="pin-input" class="pin-input" maxlength="6" readonly inputmode="none" tabindex="-1" autocomplete="off">

            <div id="pin-keypad" class="pin-keypad">
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

    const handleDigit = (digit) => {
        triggerHaptic(10);
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
        triggerHaptic(10);
        if (currentEnteredPin.length > 0) {
            currentEnteredPin = currentEnteredPin.slice(0, -1);
            updatePinBoxes();
            if (hiddenInput) hiddenInput.value = currentEnteredPin;
        }
    };

    const handleClear = () => {
        triggerHaptic(10);
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
        let deviceId = safeStorageGet('pr_device_id', '');
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

// --------------------------------------------------------------------------
// WebSocket Connection & Event Loop
// --------------------------------------------------------------------------
function connect() {
    updateStatus('reconnecting', 'Connecting...');

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        updateStatus('reconnecting', 'Authenticating...');
        currentDelay = 500;

        // Immediate Heartbeat: Keep socket alive during pending approval
        if (pingInterval) clearInterval(pingInterval);
        pingInterval = setInterval(() => {
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    m: 'core',
                    t: 'ping',
                    i: Date.now()
                }));
            }
        }, 10000);

        let token = safeStorageGet('pr_token', '');
        let deviceId = safeStorageGet('pr_device_id', '');
        if (!deviceId) {
            deviceId = generateDeviceId();
            safeStorageSet('pr_device_id', deviceId);
        }

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
        let msg;
        try {
            msg = JSON.parse(event.data);
        } catch (e) {
            return;
        }

        if (msg.m === 'core') {
            if (msg.t === 'need_pin') {
                isAuthenticated = false;
                renderPinScreen();
            } else if (msg.t === 'pending_approval') {
                isAuthenticated = false;
                showAuthOverlay(`
                    <div class="auth-card">
                        <svg viewBox="0 0 24 24" width="48" height="48" stroke="var(--accent)" stroke-width="2" fill="none" style="margin-bottom:20px; animation: status-pulse 1.6s infinite ease-in-out;"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                        <h2 class="heading" style="font-size:1.6rem; margin-bottom:8px;">Waiting for approval...</h2>
                        <p style="color:var(--muted); font-size:1rem;">Please accept the connection on your PC.</p>
                    </div>
                `);
            } else if (msg.t === 'paired') {
                safeStorageSet('pr_token', msg.d.token);
                safeStorageSet('pr_device_id', msg.d.deviceId);
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
                    isAuthenticated = false;
                    cleanup();
                    if (activeModule) {
                        activeModule.unmount();
                        activeModule = null;
                        activeModuleId = null;
                    }
                    safeStorageRemove('pr_token');
                    const freshDeviceId = generateDeviceId();
                    safeStorageSet('pr_device_id', freshDeviceId);
                    showAuthOverlay(`
                        <div class="auth-card">
                            <svg viewBox="0 0 24 24" width="60" height="60" stroke="var(--danger)" stroke-width="2" fill="none" style="margin-bottom:16px;"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"></path><line x1="12" y1="2" x2="12" y2="12"></line></svg>
                            <h2 class="heading" style="font-size:1.8rem; margin-bottom:8px;">Device Revoked</h2>
                            <p style="color:var(--muted); font-size:1rem;">Access has been revoked from the host PC. Please refresh the page to pair again.</p>
                        </div>
                    `);
                    if (ws) {
                        try { ws.close(); } catch (e) {}
                    }
                } else if (msg.d && (msg.d.type === 'paused' || msg.d.code === 'paused')) {
                    updateStatus('reconnecting', 'Remote control paused');
                    if (ws) {
                        try { ws.close(); } catch (e) {}
                    }
                }
            } else if (msg.t === 'ready') {
                isAuthenticated = true;
                hideAuthOverlay();
                updateStatus('connected', 'Connected');

                availableModules = msg.d.modules || [];
                if (msg.d.layout) {
                    currentLayout = msg.d.layout;
                    safeStorageSet('pr_layout', JSON.stringify(currentLayout));
                } else {
                    const cached = safeStorageGet('pr_layout');
                    if (cached) {
                        try { currentLayout = JSON.parse(cached); } catch (e) {}
                    }
                }

                // Initial route load
                const initialRoute = window.location.hash.replace(/^#/, '');
                renderRoute(initialRoute || 'home');

                if (!pingInterval) {
                    pingInterval = setInterval(() => {
                        if (ws.readyState === WebSocket.OPEN) {
                            ws.send(JSON.stringify({
                                m: 'core',
                                t: 'ping',
                                i: Date.now()
                            }));
                        }
                    }, 10000);
                }
            } else if (msg.t === 'layout') {
                availableModules = msg.d.available || [];
                currentLayout = msg.d.layout || [];
                safeStorageSet('pr_layout', JSON.stringify(currentLayout));
                const route = window.location.hash.replace(/^#/, '');
                if (!route || route === 'home') renderHomeScreen();
            } else if (msg.t === 'pong') {
                const rtt = Date.now() - (msg.i || 0);
                if (isAuthenticated) {
                    updateStatus('connected', `Connected, ${rtt} ms`);
                }
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
    updateStatus('reconnecting', 'Reconnecting...');
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, currentDelay);
    currentDelay = Math.min(currentDelay * 2, 5000);
}

// Initial render from local cache if present
const cachedLayout = safeStorageGet('pr_layout');
if (cachedLayout) {
    try {
        currentLayout = JSON.parse(cachedLayout);
        renderHomeScreen();
    } catch (e) {}
}

connect();

if (typeof window !== 'undefined') {
    window.renderPinScreen = renderPinScreen;
    window.showLockedOutState = showLockedOutState;
    window.showConfirmDialog = showConfirmDialog;
    window.showAuthOverlay = showAuthOverlay;
    window.hideAuthOverlay = hideAuthOverlay;
    window.generateDeviceId = generateDeviceId;
}
