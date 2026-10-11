// Handle CSRF for POSTs
const csrfToken = document.querySelector('meta[name="csrf-token"]').getAttribute('content');

function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

const pendingTimestamps = {};

async function approveDevice(deviceId, name) {
    await postAction('/admin/approve', { deviceId: deviceId, action: 'approve' });
    showToast(`Approved ${name}`, 'success');
}

async function denyDevice(deviceId, name) {
    await postAction('/admin/approve', { deviceId: deviceId, action: 'reject' });
    showToast(`Denied ${name}`, 'info');
}

function updatePendingUI(data) {
    // A PIN-set server shows nothing extra: no badge, no banner, no block
    const pendingList = (!data.pinSet && Array.isArray(data.pending)) ? data.pending : [];
    const count = pendingList.length;

    // 1. Count badge on Devices sidebar item & page title
    const badge = document.getElementById('devicesBadge');
    if (badge) {
        if (count > 0) {
            badge.textContent = count;
            badge.style.display = 'inline-block';
        } else {
            badge.style.display = 'none';
        }
    }
    document.title = count > 0 ? `(${count}) Admin` : 'Phone Remote Admin';

    // 2. Overview slim banner
    const banner = document.getElementById('overviewPendingBanner');
    const bannerText = document.getElementById('overviewPendingText');
    if (banner && bannerText) {
        if (count > 0) {
            const noun = count === 1 ? 'device' : 'devices';
            bannerText.textContent = `${count} ${noun} waiting for approval`;
            banner.style.display = 'block';
        } else {
            banner.style.display = 'none';
        }
    }

    // 3. Devices page "Pending approval" block
    renderPendingApprovals(pendingList);
}

function renderPendingApprovals(pending) {
    const container = document.getElementById('pendingApprovalsContainer');
    if (!container) return;

    if (!pending || pending.length === 0) {
        container.innerHTML = '';
        container.style.display = 'none';
        return;
    }

    // Clean up timestamps of resolved devices
    const currentIds = new Set(pending.map(p => p.deviceId));
    for (let id in pendingTimestamps) {
        if (!currentIds.has(id)) delete pendingTimestamps[id];
    }

    let phtml = `
        <div style="background: rgba(47,91,255,0.04); border: 1px solid rgba(47,91,255,0.18); border-radius: var(--radius-inner); padding: 20px; margin-bottom: 28px;">
            <div style="font-size: 1.15rem; font-weight: 700; margin-bottom: 16px; color: var(--ink); display: flex; align-items: center; gap: 8px;">
                <svg viewBox="0 0 24 24" width="20" height="20" stroke="var(--accent)" stroke-width="2" fill="none"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                Pending approval
            </div>
            <div class="table-container">
                <table class="data-table" style="background: transparent;">
                    <thead>
                        <tr>
                            <th>Device</th>
                            <th>Time Asked</th>
                            <th>IP</th>
                            <th style="text-align: right;">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
    `;

    pending.forEach(p => {
        if (!pendingTimestamps[p.deviceId]) {
            pendingTimestamps[p.deviceId] = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        }
        const timeAsked = p.timeAsked || p.created ? new Date(p.timeAsked || p.created).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : pendingTimestamps[p.deviceId];

        phtml += `
            <tr>
                <td><strong>${escapeHtml(p.name || 'Unknown Device')}</strong></td>
                <td class="mono" style="color: var(--muted);">${escapeHtml(timeAsked)}</td>
                <td class="mono" style="color: var(--muted);">${escapeHtml(p.ip || '—')}</td>
                <td style="text-align: right; white-space: nowrap;">
                    <button class="btn btn-primary" onclick="approveDevice('${escapeHtml(p.deviceId)}', '${escapeHtml(p.name || 'Device')}')">Approve</button>
                    <button class="btn btn-outline" style="margin-left: 8px;" onclick="denyDevice('${escapeHtml(p.deviceId)}', '${escapeHtml(p.name || 'Device')}')">Deny</button>
                </td>
            </tr>
        `;
    });

    phtml += `
                    </tbody>
                </table>
            </div>
        </div>
    `;

    container.innerHTML = phtml;
    container.style.display = 'block';
}

// Navigation
document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', (e) => {
        document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        document.getElementById('page-' + btn.dataset.page).classList.add('active');
        document.getElementById('breadcrumbCurrent').innerText = btn.innerText.trim();
    });
});
document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', (e) => {
        document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        document.querySelectorAll('.tab-content').forEach(p => p.classList.remove('active'));
        document.getElementById(btn.dataset.target).classList.add('active');
    });
});

// History array for chart (60 seconds)
const historyCap = Array(60).fill(0);
const historyEnc = Array(60).fill(0);

// API Polling
async function fetchState() {
    try {
        const res = await fetch('/admin/api/state');
        if (!res.ok) return;
        const data = await res.json();
        
        // Update History
        historyCap.shift(); historyCap.push(data.stats.captureMs || 0);
        historyEnc.shift(); historyEnc.push(data.stats.encodeMs || 0);

        renderOverview(data);
        renderDevices(data.devices);
        updatePendingUI(data);
        renderFrameLogs(data);
        
        // Sync security checkboxes if they aren't currently focused
        if (document.activeElement !== document.getElementById('pinInputOverview') && document.activeElement !== document.getElementById('pinInputSettings')) {
            const pinCb = document.getElementById('requirePin');
            const pinCbSet = document.getElementById('requirePinSettings');
            
            if (pinCb && !pinCb.dataset.dirty) pinCb.checked = data.pinSet;
            if (pinCbSet && !pinCbSet.dataset.dirty) pinCbSet.checked = data.pinSet;
            
            updateSecurityModeLocal(true);
        }
        
        const address = data.localIps.length > 0 ? `http://${data.localIps[0]}:8080` : 'Localhost';
        document.getElementById('serverAddressText').textContent = address;
    } catch (err) {}
}

function renderOverview(data) {
    const page = document.getElementById('page-overview');
    if (!page.classList.contains('active')) return;

    const address = data.localIps.length > 0 ? `http://${data.localIps[0]}:8080` : 'Localhost';
    
    // Connect HTML
    const connectContainer = document.getElementById('overview-connect');
    let connectHtml = `
        <div class="card col-span-4" style="display: flex; flex-direction: row; gap: 40px; padding: 40px; flex-wrap: wrap;">
            <!-- Left Column: QR Code -->
            <div style="flex: 0 0 240px; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; border-right: 1px solid var(--card-alt); padding-right: 40px;">
                <div id="qr-box" style="width:160px; height:160px; background:white; border-radius:12px; display:flex; align-items:center; justify-content:center; border: 2px solid var(--card-alt); overflow: hidden; margin-bottom: 16px;">
                </div>
                <div style="font-weight: 600; font-size: 1.1rem; margin-bottom: 12px; color: var(--ink);">Scan to Connect</div>
                <button class="btn btn-outline" style="padding: 8px 16px; font-size: 0.9rem;" onclick="showFullscreenQr('${address}')">View QR</button>
            </div>
            
            <!-- Right Column: Instructions -->
            <div style="flex: 1; display: flex; flex-direction: column; justify-content: center; min-width: 300px;">
                <h2 class="heading" style="margin-bottom:16px; font-size:1.5rem">How to Connect</h2>
                <ol style="margin-left: 20px; font-size: 1.05rem; line-height: 1.8; color: var(--muted); margin-bottom: 24px;">
                    <li>Connect your phone to the same Wi-Fi network as this PC.</li>
                    <li>Open your phone's camera and scan the QR code.</li>
                    <li>Alternatively, type the exact address below into your phone's browser.</li>
                    <li><span id="instructionStep4">Follow the security prompts (PIN or Approval) if requested.</span></li>
                </ol>
                
                <!-- Information Row -->
                <div style="display: flex; align-items: center; gap: 16px; background: var(--card-alt); padding: 12px 20px; border-radius: var(--radius-inner); flex-wrap: wrap;">
                    <div>
                        <div class="label" style="font-size:0.85rem; font-weight:600; color:var(--muted); text-transform:uppercase; letter-spacing:0.5px;">Phone Address</div>
                        <div class="mono" style="font-size: 1.25rem; font-weight: 700; color: var(--ink); margin-top:2px;">${address}</div>
                    </div>
                    <div style="width: 1px; height: 32px; background: rgba(0,0,0,0.1); margin: 0 8px;"></div>
                    <div>
                        <div class="label" style="font-size:0.85rem; font-weight:600; color:var(--muted); text-transform:uppercase; letter-spacing:0.5px;">Port</div>
                        <div class="mono" style="font-size: 1.25rem; font-weight: 700; color: var(--ink); margin-top:2px;">8080</div>
                    </div>
                    <div style="margin-left: auto;">
                        <button class="btn btn-primary" onclick="navigator.clipboard.writeText('${address}')" style="padding: 10px 16px; font-size: 0.9rem;">Copy URL</button>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    if (connectContainer.dataset.lastHtml !== connectHtml) {
        connectContainer.innerHTML = connectHtml;
        connectContainer.dataset.lastHtml = connectHtml;
        if (typeof QRCode !== 'undefined') {
            new QRCode(document.getElementById("qr-box"), {
                text: address,
                width: 152,
                height: 152,
                colorDark : "#05070B",
                colorLight : "#ffffff",
                correctLevel : QRCode.CorrectLevel.L
            });
        }
    }

    // Devices HTML
    const devicesContainer = document.getElementById('overview-devices');
    let devicesHtml = `
        <!-- Black Card (Devices) -->
        <div class="card card-black col-span-4">
            <h2 class="heading" style="margin-bottom:16px; font-size:1.5rem">Paired Devices</h2>
    `;
    
    if (data.devices.length === 0) {
        devicesHtml += `<div style="color:#8C96A8; text-align:center; padding:24px;">No devices paired. Connect your phone to get started.</div>`;
    } else {
        devicesHtml += `<div class="table-container"><table class="data-table"><tbody>`;
        data.devices.forEach(d => {
            const seen = new Date(d.lastSeen).toLocaleString();
            let parsedName = d.name;
            if (d.name.length > 20 && d.name.includes('Mozilla')) {
                let os = 'Unknown';
                if (d.name.includes('Android')) os = 'Android';
                else if (d.name.includes('iPhone') || d.name.includes('iPad')) os = 'iOS';
                else if (d.name.includes('Windows')) os = 'Windows';
                else if (d.name.includes('Mac OS')) os = 'Mac';
                else if (d.name.includes('Linux')) os = 'Linux';
                
                let browser = 'Browser';
                if (d.name.includes('Firefox')) browser = 'Firefox';
                else if (d.name.includes('Edg')) browser = 'Edge';
                else if (d.name.includes('Chrome')) browser = 'Chrome';
                else if (d.name.includes('Safari')) browser = 'Safari';
                
                parsedName = `${os} · ${browser}`;
            }
            
            devicesHtml += `<tr>
                <td><strong title="${d.name}">${parsedName}</strong></td>
                <td class="mono" style="color:#8C96A8">${seen}</td>
                <td style="text-align:right; position:relative;">
                    <details class="dropdown" style="display:inline-block; position:relative; text-align:left;">
                        <summary style="list-style:none; cursor:pointer; color:var(--muted); padding:4px 8px; border-radius:4px;" aria-label="Device Actions">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><circle cx="12" cy="12" r="1"></circle><circle cx="12" cy="5" r="1"></circle><circle cx="12" cy="19" r="1"></circle></svg>
                        </summary>
                        <div style="position:absolute; right:0; top:100%; background:var(--card); border:1px solid var(--card-alt); border-radius:var(--radius-inner); box-shadow:var(--shadow); z-index:10; min-width:140px; padding:8px; margin-top:4px;">
                            <button style="width:100%; text-align:left; background:none; border:none; color:var(--danger); font-family:inherit; font-size:0.9rem; font-weight:600; padding:8px 12px; cursor:pointer; border-radius:8px;" onmouseover="this.style.background='rgba(229,48,58,0.1)'" onmouseout="this.style.background='none'" onclick="revoke('${d.deviceId}')">Revoke device</button>
                        </div>
                    </details>
                </td>
            </tr>`;
        });
        devicesHtml += `</tbody></table></div>`;
    }
    
    devicesHtml += `</div>`;

    if (devicesContainer.dataset.lastHtml !== devicesHtml) {
        devicesContainer.innerHTML = devicesHtml;
        devicesContainer.dataset.lastHtml = devicesHtml;
    }
}



function renderDevices(devices) {
    const tbody = document.querySelector('#devicesTable tbody');
    if (!tbody) return;

    // Handle Paired
    if (!devices || devices.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:32px;">No devices paired. Connect your phone to get started.</td></tr>`;
        return;
    }
    let html = '';
    devices.forEach(d => {
        const date = new Date(d.created).toLocaleString();
        const seen = new Date(d.lastSeen).toLocaleString();
        
        let parsedName = d.name;
        if (d.name.length > 20 && d.name.includes('Mozilla')) {
            let os = 'Unknown';
            if (d.name.includes('Android')) os = 'Android';
            else if (d.name.includes('iPhone') || d.name.includes('iPad')) os = 'iOS';
            else if (d.name.includes('Windows')) os = 'Windows';
            else if (d.name.includes('Mac OS')) os = 'Mac';
            else if (d.name.includes('Linux')) os = 'Linux';
            
            let browser = 'Browser';
            if (d.name.includes('Firefox')) browser = 'Firefox';
            else if (d.name.includes('Edg')) browser = 'Edge';
            else if (d.name.includes('Chrome')) browser = 'Chrome';
            else if (d.name.includes('Safari')) browser = 'Safari';
            
            parsedName = `${os} · ${browser}`;
        }
        
        html += `<tr>
            <td><strong title="${d.name}">${parsedName}</strong></td>
            <td class="mono">${date}</td>
            <td class="mono">${seen}</td>
            <td class="mono">${d.lastIp}</td>
            <td style="text-align:right"><button class="btn btn-danger" onclick="revoke('${d.deviceId}')">Revoke</button></td>
        </tr>`;
    });
    tbody.innerHTML = html;
}

async function fetchLogs(force = false) {
    const autoRef = document.getElementById('logAutoRefresh');
    if (!force && (!autoRef || !autoRef.checked)) return;
    const lvl = document.getElementById('logLevelFilter').value;
    const q = encodeURIComponent(document.getElementById('logSearch').value);
    
    try {
        const res = await fetch(`/admin/api/logs?level=${lvl}&search=${q}`);
        const data = await res.json();
        
        let appHtml = '';
        let frameHtml = '';
        let framesCount = 0;
        let sumCap=0, sumEnc=0;
        
        data.logs.forEach(l => {
            if (l.formatted.includes('com.phoneremote.frames -')) {
                const match = l.formatted.match(/Capture: (\d+)ms.*Scale: (\d+)ms, Encode: (\d+)ms.*Size: (\d+)KB/);
                if (match) {
                    framesCount++;
                    sumCap += parseInt(match[1]);
                    sumEnc += parseInt(match[3]);
                    const time = l.formatted.split(' ')[0].split('.')[0].split('T')[1] || l.formatted.split(' ')[1];
                    frameHtml = `<tr>
                        <td>${time}</td>
                        <td>${match[1]} ms</td>
                        <td>${match[2]} ms</td>
                        <td>${match[3]} ms</td>
                        <td>-</td>
                        <td>${match[4]} KB</td>
                    </tr>` + frameHtml;
                }
            } else {
                let cls = 'log-debug';
                if(l.level==='INFO') cls='log-info';
                if(l.level==='WARN') cls='log-warn';
                if(l.level==='ERROR') cls='log-error';
                appHtml += `<span class="${cls}">${l.formatted}</span>\n`;
            }
        });
        
        const appOut = document.getElementById('appLogOutput');
        if (appOut) appOut.innerHTML = appHtml || '<i>No app logs in buffer.</i>';
        
        const frameTbody = document.querySelector('#frameLogTable tbody');
        if (frameTbody) {
            if (framesCount === 0) {
                frameTbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:40px;">No frames yet. Open the screen view on your phone.</td></tr>`;
                document.getElementById('frameLogHeader').innerHTML = `<span class="lbl">Waiting for stream...</span>`;
            } else {
                frameTbody.innerHTML = frameHtml;
                document.getElementById('frameLogHeader').innerHTML = `
                    <div><span class="lbl">Avg Cap:</span> <span>${Math.round(sumCap/framesCount)}ms</span></div>
                    <div><span class="lbl">Avg Enc:</span> <span>${Math.round(sumEnc/framesCount)}ms</span></div>
                    <div><span class="lbl">Status:</span> <span style="color:var(--accent)">Healthy</span></div>
                `;
            }
        }
    } catch (err) {}
}

async function postAction(url, data) {
    const formData = new URLSearchParams();
    formData.append('csrf', csrfToken);
    for (let k in data) formData.append(k, data[k]);
    await fetch(url, { method: 'POST', body: formData, headers: {'Content-Type': 'application/x-www-form-urlencoded'} });
    fetchState();
}

function revoke(id) {
    showConfirm('Revoke access for this device?', () => {
        postAction('/admin/revoke', { deviceId: id });
        showToast('Device revoked successfully.', 'success');
    });
}
function revokeAll() {
    showConfirm('Revoke access for ALL devices?', () => {
        postAction('/admin/revoke', { action: 'all' });
        showToast('All devices revoked.', 'success');
    });
}



let pageLoadTime = Date.now();
setInterval(() => {
    const el = document.getElementById('uptimeDisplay');
    if (el) {
        let diff = Math.floor((Date.now() - pageLoadTime) / 1000);
        let h = Math.floor(diff / 3600).toString().padStart(2, '0');
        let m = Math.floor((diff % 3600) / 60).toString().padStart(2, '0');
        let s = (diff % 60).toString().padStart(2, '0');
        el.textContent = `${h}:${m}:${s}`;
    }
}, 1000);

// Visibility-aware 3-second state polling
let statePollInterval = null;

function startStatePolling() {
    if (!statePollInterval) {
        statePollInterval = setInterval(fetchState, 3000);
    }
}

function stopStatePolling() {
    if (statePollInterval) {
        clearInterval(statePollInterval);
        statePollInterval = null;
    }
}

document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        stopStatePolling();
    } else {
        fetchState();
        startStatePolling();
    }
});

// Init
fetchState();
if (!document.hidden) {
    startStatePolling();
}
setInterval(() => fetchLogs(false), 3000);
fetchLogs(true);

function updateSecurityModeLocal(fromSync = false, fromSettingsPage = false) {
    const pinCb = document.getElementById('requirePin');
    const pinContainer = document.getElementById('pinInputContainer');
    const vulnWarning = document.getElementById('vulnWarning');

    const pinCbSet = document.getElementById('requirePinSettings');
    const pinContainerSet = document.getElementById('pinInputContainerSettings');
    const vulnWarningSet = document.getElementById('vulnWarningSettings');

    // Sync state between the two checkboxes if triggered by user
    if (!fromSync) {
        if (fromSettingsPage && pinCbSet && pinCb) {
            pinCb.checked = pinCbSet.checked;
        } else if (!fromSettingsPage && pinCb && pinCbSet) {
            pinCbSet.checked = pinCb.checked;
        }
        if (pinCb) pinCb.dataset.dirty = 'true';
        if (pinCbSet) pinCbSet.dataset.dirty = 'true';
    }

    if (pinCb) {
        if (pinCb.checked) {
            if (pinContainer) pinContainer.style.display = 'flex';
            if (vulnWarning) vulnWarning.style.display = 'none';
        } else {
            if (pinContainer) pinContainer.style.display = 'none';
            if (vulnWarning) vulnWarning.style.display = 'block';
        }
    }
    
    if (pinCbSet) {
        if (pinCbSet.checked) {
            if (pinContainerSet) pinContainerSet.style.display = 'flex';
            if (vulnWarningSet) vulnWarningSet.style.display = 'none';
        } else {
            if (pinContainerSet) pinContainerSet.style.display = 'none';
            if (vulnWarningSet) vulnWarningSet.style.display = 'block';
        }
    }
    
    const inst = document.getElementById('instructionStep4');
    if (inst) {
        if (pinCb && pinCb.checked) {
            inst.innerText = 'Enter the security PIN on your phone when prompted.';
        } else {
            inst.innerText = 'No PIN required. Connection is instantly open.';
        }
    }
}

function saveSecuritySettings(isSettingsPage = false) {
    const pinCb = document.getElementById(isSettingsPage ? 'requirePinSettings' : 'requirePin');
    const pinInput = document.getElementById(isSettingsPage ? 'pinInputSettings' : 'pinInputOverview');
    
    const otherPinCb = document.getElementById(!isSettingsPage ? 'requirePinSettings' : 'requirePin');

    const data = {};

    if (pinCb.checked) {
        if (pinInput.value) {
            if (!/^\d{6}$/.test(pinInput.value)) {
                showToast('Please enter a valid 6-digit PIN', 'error');
                return;
            }
            data.pinAction = 'set';
            data.pin = pinInput.value;
        } else {
            showToast('Please enter a 6-digit PIN to save.', 'error');
            return;
        }
    } else {
        data.pinAction = 'remove';
    }

    postAction('/admin/security', data);
    if (pinCb) pinCb.dataset.dirty = '';
    if (otherPinCb) otherPinCb.dataset.dirty = '';
    pinInput.value = '';
    showToast('Security settings updated successfully.', 'success');
}

function clearLockouts() {
    showConfirm('Are you sure you want to clear all IP and device lockouts? This will unban any brute-forcers.', async () => {
        await postAction('/admin/api/lockouts', { action: 'clear' });
        showToast('All lockouts cleared successfully.', 'success');
    });
}

function showToast(message, type = 'success') {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.style.cssText = 'position:fixed; bottom:24px; right:24px; display:flex; flex-direction:column; gap:12px; z-index:9999; pointer-events:none;';
        document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    const bgColor = type === 'error' ? 'var(--danger)' : 'var(--ink)';
    toast.style.cssText = `background:${bgColor}; color:white; padding:16px 24px; border-radius:8px; box-shadow:0 8px 24px rgba(0,0,0,0.15); font-weight:600; font-size:0.95rem; opacity:0; transform:translateY(20px); transition:all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275); pointer-events:auto;`;
    toast.innerText = message;
    container.appendChild(toast);
    
    requestAnimationFrame(() => {
        toast.style.opacity = '1';
        toast.style.transform = 'translateY(0)';
    });
    
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(10px)';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function showConfirm(message, onConfirm) {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.4); backdrop-filter:blur(4px); z-index:10000; display:flex; align-items:center; justify-content:center; opacity:0; transition:opacity 0.2s;';
    
    const modal = document.createElement('div');
    modal.style.cssText = 'background:white; padding:32px; border-radius:16px; box-shadow:0 16px 48px rgba(0,0,0,0.2); max-width:400px; width:90%; transform:scale(0.95); transition:transform 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275); border:1px solid rgba(0,0,0,0.05);';
    
    modal.innerHTML = `
        <h3 style="margin:0 0 16px 0; font-size:1.3rem; font-weight:700;">Confirm Action</h3>
        <p style="margin:0 0 32px 0; color:var(--muted); font-size:1.05rem; line-height:1.5;">${message}</p>
        <div style="display:flex; justify-content:flex-end; gap:12px;">
            <button id="modalCancel" class="btn btn-outline" style="padding:10px 20px;">Cancel</button>
            <button id="modalConfirm" class="btn btn-primary" style="background:var(--danger); border-color:var(--danger); color:white; padding:10px 20px;">Confirm</button>
        </div>
    `;
    
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    
    requestAnimationFrame(() => {
        overlay.style.opacity = '1';
        modal.style.transform = 'scale(1)';
    });
    
    const close = () => {
        overlay.style.opacity = '0';
        modal.style.transform = 'scale(0.95)';
        setTimeout(() => overlay.remove(), 200);
    };
    
    modal.querySelector('#modalCancel').onclick = close;
    modal.querySelector('#modalConfirm').onclick = () => {
        close();
        onConfirm();
    };
}

function showFullscreenQr(address) {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.6); backdrop-filter:blur(6px); z-index:10000; display:flex; align-items:center; justify-content:center; opacity:0; transition:opacity 0.2s;';
    
    function closeQr() {
        overlay.style.opacity = '0';
        overlay.querySelector('.qr-modal').style.transform = 'scale(0.95)';
        setTimeout(() => overlay.remove(), 200);
    }

    overlay.onclick = (e) => {
        if (e.target === overlay) closeQr();
    };
    
    overlay.innerHTML = `
        <div class="qr-modal" style="background:var(--card); padding:40px; border-radius:24px; box-shadow:0 24px 64px rgba(0,0,0,0.3); display:flex; flex-direction:column; align-items:center; position:relative; transform:scale(0.95); transition:transform 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275);">
            <button id="closeQrBtn" style="position:absolute; top:24px; right:24px; background:none; border:none; cursor:pointer; color:var(--muted); padding:8px; border-radius:50%; display:flex; align-items:center; justify-content:center; transition:background 0.2s;">
                <svg viewBox="0 0 24 24" width="28" height="28" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
            <div style="background:white; padding:24px; border-radius:16px; margin-bottom:24px; border:1px solid rgba(0,0,0,0.05);">
                <div id="fullscreen-qr"></div>
            </div>
            <h2 style="font-size:1.8rem; font-weight:800; margin-bottom:12px;">Scan to Connect</h2>
            <p style="font-size:1.1rem; color:var(--muted); font-family:monospace; font-weight:700; padding:10px 20px; background:rgba(0,0,0,0.04); border-radius:8px; margin:0; user-select:all;">${address}</p>
        </div>
    `;
    
    document.body.appendChild(overlay);
    
    const closeBtn = overlay.querySelector('#closeQrBtn');
    closeBtn.onmouseover = () => closeBtn.style.background = 'rgba(0,0,0,0.05)';
    closeBtn.onmouseout = () => closeBtn.style.background = 'none';
    closeBtn.onclick = closeQr;
    
    new QRCode(overlay.querySelector('#fullscreen-qr'), {
        text: address,
        width: 320,
        height: 320,
        colorDark : "#1a1f2c",
        colorLight : "#ffffff",
        correctLevel : QRCode.CorrectLevel.H
    });
    
    requestAnimationFrame(() => {
        overlay.style.opacity = '1';
        overlay.querySelector('.qr-modal').style.transform = 'scale(1)';
    });
}

function renderFrameLogs(data) {
    const uptimeEl = document.getElementById('serverUptimeDisplay');
    if (uptimeEl) {
        const up = data.uptimeSeconds || 0;
        const days = Math.floor(up / 86400);
        const hours = Math.floor((up % 86400) / 3600);
        const mins = Math.floor((up % 3600) / 60);
        const secs = up % 60;
        let uptimeStr = `${hours}h ${mins}m ${secs}s`;
        if (days > 0) uptimeStr = `${days}d ` + uptimeStr;
        uptimeEl.innerText = uptimeStr;
    }

    const s = data.stats;
    const header = document.getElementById('frameLogHeader');
    if (header && s) {
        header.innerHTML = `
            <div class="stat-pill"><span style="color:var(--muted)">Avg FPS</span><br><span style="font-size:1.5rem;font-weight:700;color:var(--primary)">${s.fps}</span></div>
            <div class="stat-pill"><span style="color:var(--muted)">Skipped</span><br><span style="font-size:1.5rem;font-weight:700;color:var(--danger)">${s.skippedFrames}/5s</span></div>
            <div class="stat-pill"><span style="color:var(--muted)">Capture</span><br><span style="font-size:1.5rem;font-weight:700">${s.captureMs}ms</span></div>
            <div class="stat-pill"><span style="color:var(--muted)">Encode</span><br><span style="font-size:1.5rem;font-weight:700">${s.encodeMs}ms</span></div>
            <div class="stat-pill"><span style="color:var(--muted)">Bandwidth</span><br><span style="font-size:1.5rem;font-weight:700">${s.frameSizeKB}KB</span></div>
        `;
    }

    const tbody = document.querySelector('#frameLogTable tbody');
    if (tbody && s && s.recentFrames) {
        let html = '';
        s.recentFrames.forEach(f => {
            const date = new Date(f.timestamp);
            const timeStr = date.toLocaleTimeString([], {hour12:false}) + '.' + date.getMilliseconds().toString().padStart(3, '0');
            if (f.skipped) {
                html += `<tr style="color:var(--danger)">
                    <td>${timeStr}</td>
                    <td colspan="4" style="text-align:center; font-weight:700;">FRAME SKIPPED (Client Too Slow)</td>
                </tr>`;
            } else {
                html += `<tr>
                    <td>${timeStr}</td>
                    <td>${f.captureMs}ms</td>
                    <td>${f.scaleMs}ms</td>
                    <td>${f.encodeMs}ms</td>
                    <td>${f.frameSizeKB}KB</td>
                </tr>`;
            }
        });
        if (html === '') {
            html = `<tr><td colspan="5" style="text-align:center;color:var(--muted)">No streaming activity...</td></tr>`;
        }
        tbody.innerHTML = html;
    }
}
