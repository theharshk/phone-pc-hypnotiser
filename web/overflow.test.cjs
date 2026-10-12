const cp = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const server = http.createServer((req, res) => {
    let reqPath = req.url.split('?')[0];
    if (reqPath === '/') reqPath = '/index.html';
    let fullPath = fs.existsSync(path.join(__dirname, reqPath)) ? path.join(__dirname, reqPath) : path.join(__dirname, 'web', reqPath);
    if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
        const ext = path.extname(fullPath);
        const map = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.woff2': 'font/woff2', '.png': 'image/png' };
        res.writeHead(200, { 'Content-Type': map[ext] || 'text/plain' });
        res.end(fs.readFileSync(fullPath));
    } else {
        res.writeHead(404);
        res.end();
    }
});

const port = 49202;
server.listen(port, async () => {
    const chrome = cp.spawn(chromePath, [
        '--headless=new',
        '--remote-debugging-port=9225',
        '--user-data-dir=' + path.join(process.env.TEMP, 'chrome-test-' + Date.now()),
        'http://127.0.0.1:' + port + '/'
    ]);

    await new Promise(r => setTimeout(r, 1500));

    try {
        const listRes = await fetch('http://127.0.0.1:9225/json/list');
        const tabs = await listRes.json();
        const tab = tabs.find(t => t.url.includes(port.toString())) || tabs[0];
        const wsUrl = tab.webSocketDebuggerUrl;

        const ws = new WebSocket(wsUrl);
        await new Promise((res, rej) => {
            ws.onopen = res;
            ws.onerror = rej;
        });

        let id = 1;
        function call(method, params = {}) {
            return new Promise((resolve) => {
                const reqId = id++;
                const onMsg = (evt) => {
                    const data = JSON.parse(evt.data);
                    if (data.id === reqId) {
                        ws.removeEventListener('message', onMsg);
                        resolve(data.result);
                    }
                };
                ws.addEventListener('message', onMsg);
                ws.send(JSON.stringify({ id: reqId, method, params }));
            });
        }

        const viewports = [
            { w: 320, h: 640, name: '320px Portrait' },
            { w: 360, h: 740, name: '360px Portrait' },
            { w: 390, h: 844, name: '390px Portrait' },
            { w: 412, h: 915, name: '412px Portrait' },
            { w: 430, h: 932, name: '430px Portrait' },
            { w: 844, h: 390, name: '844x390 Landscape' }
        ];

        const testStates = [
            { name: 'Home View', hash: '#home', prep: '' },
            { name: 'Settings View', hash: '#settings', prep: '' },
            { name: 'Pairing Screen', hash: '#home', prep: 'renderPinScreen()' },
            { name: 'Locked Overlay', hash: '#home', prep: 'showLockedOutState(300)' },
            { name: 'Confirmation Modal', hash: '#home', prep: 'showConfirmDialog({ title: "Lock PC?", message: "Are you sure you want to lock the workstation?", confirmText: "Lock", onConfirm: () => {} })' },
            { name: 'Revoked Overlay', hash: '#home', prep: 'showAuthOverlay(\`<div class="auth-card"><h2 class="heading">Device Revoked</h2><p>Access revoked</p></div>\`)' },
            { name: 'Keyboard Module', hash: '#keyboard', prep: '' }
        ];

        for (const vp of viewports) {
            await call('Emulation.setDeviceMetricsOverride', {
                width: vp.w,
                height: vp.h,
                deviceScaleFactor: 1,
                mobile: true
            });

            for (const st of testStates) {
                if (st.hash) {
                    await call('Page.navigate', { url: 'http://127.0.0.1:' + port + '/' + st.hash });
                    await new Promise(r => setTimeout(r, 100));
                }
                if (st.prep) {
                    await call('Runtime.evaluate', { expression: st.prep });
                    await new Promise(r => setTimeout(r, 100));
                }

                const checkScript = `
                    (function() {
                        const sw = document.documentElement.scrollWidth;
                        const iw = window.innerWidth;
                        const overflow = sw > iw;
                        const passThrough = [];
                        document.querySelectorAll('*').forEach(el => {
                            const r = el.getBoundingClientRect();
                            if (r.right > iw + 0.5) {
                                passThrough.push(el.tagName + (el.id ? '#' + el.id : '') + (el.className ? '.' + el.className.split(' ').join('.') : '') + ' (right=' + r.right.toFixed(1) + ')');
                            }
                        });
                        return JSON.stringify({ sw, iw, overflow, passThrough });
                    })()
                `;

                const evalRes = await call('Runtime.evaluate', { expression: checkScript, returnByValue: true });
                const res = JSON.parse(evalRes.result.value);
                const statusStr = res.overflow ? 'FAIL: overflowed by ' + (res.sw - res.iw) + 'px' : 'PASS (scrollWidth=' + res.sw + 'px <= innerWidth=' + res.iw + 'px)';
                console.log(`[${vp.name}] ${st.name}: ${statusStr}`);
                if (res.passThrough.length > 0) {
                    console.log('   Overhanging elements: ' + res.passThrough.join(', '));
                }
            }
        }

        ws.close();
    } catch(e) {
        console.error('CDP Error:', e);
    } finally {
        chrome.kill();
        server.close();
    }
});
