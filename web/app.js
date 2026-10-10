const statusIndicator = document.getElementById('status-indicator');
const statusText = document.getElementById('status-text');

let ws = null;
let reconnectTimer = null;
let pingInterval = null;
let currentDelay = 500;

function updateStatus(state, text) {
    statusIndicator.className = state;
    statusText.textContent = text;
}

function connect() {
    updateStatus('reconnecting', 'Connecting...');
    
    // Determine websocket URL based on current host
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    // Use host and port of the page
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    
    ws = new WebSocket(wsUrl);
    
    ws.onopen = () => {
        updateStatus('reconnecting', 'Authenticating...');
        currentDelay = 500; // Reset delay on success
        
        // Send hello
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
        console.log('Received:', msg);
        
        if (msg.m === 'core') {
            if (msg.t === 'ready') {
                updateStatus('connected', 'Connected');
                
                // Start heartbeat
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
    
    reconnectTimer = setTimeout(() => {
        connect();
    }, currentDelay);
    
    // Backoff up to 5 seconds
    currentDelay = Math.min(currentDelay * 2, 5000);
}

// Start connection process
connect();
