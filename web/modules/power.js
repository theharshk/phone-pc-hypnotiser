export default {
    id: 'power',
    name: 'Power',
    icon: '⚡',
    
    mount(el, api) {
        this.el = el;
        this.api = api;
        
        el.innerHTML = `
            <div id="power-main" style="padding: 24px; display: flex; flex-direction: column; gap: 12px;">
                <button class="pwr-btn" data-action="Shut down" data-api="SHUTDOWN" style="padding: 20px; background: var(--surface); color: var(--danger); border: none; border-radius: 18px; font-size: 1.1rem; font-weight:600; text-align: left;">Shut down</button>
                <button class="pwr-btn" data-action="Restart" data-api="RESTART" style="padding: 20px; background: var(--surface); color: var(--text); border: none; border-radius: 18px; font-size: 1.1rem; font-weight:600; text-align: left;">Restart</button>
                <button class="pwr-btn" data-action="Sleep" data-api="SLEEP" style="padding: 20px; background: var(--surface); color: var(--text); border: none; border-radius: 18px; font-size: 1.1rem; font-weight:600; text-align: left;">Sleep</button>
                <button class="pwr-btn" data-action="Hibernate" data-api="HIBERNATE" style="padding: 20px; background: var(--surface); color: var(--text); border: none; border-radius: 18px; font-size: 1.1rem; font-weight:600; text-align: left;">Hibernate</button>
                <button class="pwr-btn" data-action="Lock" data-api="LOCK" style="padding: 20px; background: var(--surface); color: var(--text); border: none; border-radius: 18px; font-size: 1.1rem; font-weight:600; text-align: left;">Lock</button>
                <button id="pwr-cancel-pending" style="padding: 20px; background: transparent; color: var(--muted); border: 2px dashed var(--border); border-radius: 18px; font-size: 1.1rem; font-weight:600; text-align: center; margin-top: 12px;">Cancel pending action</button>
            </div>
            
            <div id="power-confirm" style="display: none; padding: 24px; flex-direction: column; height: 100%; box-sizing: border-box;">
                <div style="background: var(--danger-surface); border: 1px solid var(--danger); border-radius: 22px; padding: 24px; display: flex; flex-direction: column; gap: 24px;">
                    <div>
                        <h2 id="confirm-title" style="color: var(--danger); font-size: 1.4rem; margin-bottom: 8px;">Confirm</h2>
                        <p id="confirm-warning" style="color: var(--text); margin: 0; font-size: 1rem;">This will immediately execute the command and cannot be undone.</p>
                    </div>
                    
                    <div style="position: relative; width: 100%; height: 56px; background: var(--surface-raised); border-radius: 20px; overflow: hidden;">
                        <div id="confirm-fill" style="position: absolute; top: 0; left: 0; height: 100%; width: 0%; background: var(--danger); transition: width 0.1s linear;"></div>
                        <button id="confirm-hold" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: transparent; color: var(--text); border: none; font-size: 1.1rem; font-weight: 600; z-index: 2;">Hold to confirm</button>
                    </div>
                    
                    <button id="confirm-schedule" style="display: none; padding: 16px; width: 100%; background: var(--surface-raised); color: var(--text); border: none; border-radius: 18px; font-size: 1.1rem; font-weight: 600;">Shut down in 1 minute</button>
                    
                    <button id="confirm-cancel" style="padding: 16px; width: 100%; background: transparent; color: var(--muted); border: none; font-size: 1.1rem; font-weight: 600;">Cancel</button>
                </div>
            </div>
            
            <div id="power-msg" style="display: none; padding: 24px; height: 100%; flex-direction: column; align-items: center; justify-content: center;">
                <div style="width: 64px; height: 64px; border-radius: 50%; background: var(--accent); display: flex; align-items: center; justify-content: center; margin-bottom: 24px;">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--on-accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                </div>
                <h2 id="msg-text" style="color: var(--text); font-size: 1.4rem;">Command sent</h2>
            </div>
`;
        
        const main = el.querySelector('#power-main');
        const confirm = el.querySelector('#power-confirm');
        const msg = el.querySelector('#power-msg');
        
        let pendingActionApi = null;
        let pendingActionName = null;
        let pendingToken = null;
        
        el.querySelectorAll('.pwr-btn').forEach(btn => {
            btn.onclick = () => {
                pendingActionApi = btn.getAttribute('data-api'); pendingActionName = btn.getAttribute('data-action');
                api.send('request', { action: pendingActionApi });
                
                main.style.display = 'none';
                confirm.style.display = 'flex';
                el.querySelector('#confirm-title').textContent = pendingActionName; el.querySelector('#confirm-hold').textContent = 'Hold to ' + pendingActionName.toLowerCase();
                
                if (pendingActionApi === 'SHUTDOWN') {
                    el.querySelector('#confirm-schedule').style.display = 'block';
                } else {
                    el.querySelector('#confirm-schedule').style.display = 'none';
                }
                
                el.querySelector('#confirm-fill').style.width = '0%';
            };
        });
        
        el.querySelector('#pwr-cancel-pending').onclick = () => {
            api.send('cancel', {});
            el.querySelector('#msg-text').textContent = 'Cancel sent';
            main.style.display = 'none';
            msg.style.display = 'flex';
            setTimeout(() => {
                msg.style.display = 'none';
                main.style.display = 'flex';
            }, 2000);
        };
        
        api.on = (type, data) => {
            if (type === 'token') {
                pendingToken = data.token;
            } else if (type === 'ack') {
                confirm.style.display = 'none';
                el.querySelector('#msg-text').textContent = pendingActionName + ' sent';
                msg.style.display = 'flex';
                setTimeout(() => {
                    msg.style.display = 'none';
                    main.style.display = 'flex';
                }, 2000);
            } else if (type === 'error') {
                alert('Token expired or invalid');
                confirm.style.display = 'none';
                main.style.display = 'flex';
            }
        };
        
        const holdBtn = el.querySelector('#confirm-hold');
        const fill = el.querySelector('#confirm-fill');
        let holdTimer = null;
        let holdProgress = 0;
        
        const endHold = () => {
            clearInterval(holdTimer);
            holdProgress = 0;
            fill.style.width = '0%';
        };
        
        const startHold = (e) => {
            e.preventDefault();
            if (!pendingToken) return;
            
            holdProgress = 0;
            fill.style.width = '0%';
            
            holdTimer = setInterval(() => {
                holdProgress += 100 / 15; if (navigator.vibrate && holdProgress % 30 < 6) navigator.vibrate(10);
                fill.style.width = holdProgress + '%';
                
                if (holdProgress >= 100) {
                    clearInterval(holdTimer);
                    api.send('execute', { token: pendingToken, action: pendingActionApi });
                }
            }, 100);
        };
        
        holdBtn.addEventListener('touchstart', startHold);
        holdBtn.addEventListener('touchend', endHold);
        holdBtn.addEventListener('mousedown', startHold);
        holdBtn.addEventListener('mouseup', endHold);
        holdBtn.addEventListener('mouseleave', endHold);
        
        el.querySelector('#confirm-schedule').onclick = () => {
            if (!pendingToken) return;
            api.send('schedule', { token: pendingToken, action: pendingActionApi, seconds: 60 });
        };
        
        el.querySelector('#confirm-cancel').onclick = () => {
            pendingAction = null;
            pendingToken = null;
            confirm.style.display = 'none';
            main.style.display = 'flex';
        };
    },
    
    unmount() {
        if (this.el) this.el.innerHTML = '';
        if (this.api) this.api.on = null;
    }
};
