export default {
    id: 'power',
    name: 'Power',
    icon: '⚡',
    
    mount(el, api) {
        this.el = el;
        this.api = api;
        
        el.innerHTML = `
            <div id="power-main" style="padding: 20px; display: flex; flex-direction: column; gap: 15px;">
                <button class="pwr-btn" data-action="SHUTDOWN" style="padding: 15px; background: #e53935; color: white; border: none; border-radius: 8px; font-size: 18px;">Shut Down</button>
                <button class="pwr-btn" data-action="RESTART" style="padding: 15px; background: #fb8c00; color: white; border: none; border-radius: 8px; font-size: 18px;">Restart</button>
                <button class="pwr-btn" data-action="SLEEP" style="padding: 15px; background: #1e88e5; color: white; border: none; border-radius: 8px; font-size: 18px;">Sleep</button>
                <button class="pwr-btn" data-action="HIBERNATE" style="padding: 15px; background: #5e35b1; color: white; border: none; border-radius: 8px; font-size: 18px;">Hibernate</button>
                <button class="pwr-btn" data-action="LOCK" style="padding: 15px; background: #757575; color: white; border: none; border-radius: 8px; font-size: 18px;">Lock Workstation</button>
                <button id="pwr-cancel-pending" style="padding: 15px; background: #333; color: white; border: 1px solid #555; border-radius: 8px; font-size: 18px; margin-top: 20px;">Cancel Pending Action</button>
            </div>
            
            <div id="power-confirm" style="display: none; padding: 20px; flex-direction: column; gap: 15px; align-items: center; justify-content: center; height: 100%;">
                <h2 id="confirm-title" style="margin: 0;">Confirm</h2>
                <div style="position: relative; width: 100%; height: 60px; background: #333; border-radius: 8px; overflow: hidden; margin: 20px 0;">
                    <div id="confirm-fill" style="position: absolute; top: 0; left: 0; height: 100%; width: 0%; background: #e53935; transition: width 0.1s linear;"></div>
                    <button id="confirm-hold" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: transparent; color: white; border: none; font-size: 18px; font-weight: bold; z-index: 2;">Hold to Confirm</button>
                </div>
                <button id="confirm-schedule" style="display: none; padding: 15px; width: 100%; background: #fb8c00; color: white; border: none; border-radius: 8px; font-size: 18px;">Shut down in 1 minute</button>
                <button id="confirm-cancel" style="padding: 15px; width: 100%; background: #555; color: white; border: none; border-radius: 8px; font-size: 18px; margin-top: 10px;">Cancel</button>
            </div>
            <div id="power-msg" style="display: none; padding: 20px; text-align: center; font-size: 20px; color: #4caf50;">Command sent</div>
        `;
        
        const main = el.querySelector('#power-main');
        const confirm = el.querySelector('#power-confirm');
        const msg = el.querySelector('#power-msg');
        
        let pendingAction = null;
        let pendingToken = null;
        
        el.querySelectorAll('.pwr-btn').forEach(btn => {
            btn.onclick = () => {
                pendingAction = btn.getAttribute('data-action');
                api.send('request', { action: pendingAction });
                
                main.style.display = 'none';
                confirm.style.display = 'flex';
                el.querySelector('#confirm-title').textContent = 'Confirm ' + pendingAction;
                
                if (pendingAction === 'SHUTDOWN') {
                    el.querySelector('#confirm-schedule').style.display = 'block';
                } else {
                    el.querySelector('#confirm-schedule').style.display = 'none';
                }
                
                el.querySelector('#confirm-fill').style.width = '0%';
            };
        });
        
        el.querySelector('#pwr-cancel-pending').onclick = () => {
            api.send('cancel', {});
            msg.textContent = 'Cancel sent';
            main.style.display = 'none';
            msg.style.display = 'block';
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
                msg.textContent = 'Command sent';
                msg.style.display = 'block';
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
                holdProgress += 100 / 15;
                fill.style.width = holdProgress + '%';
                
                if (holdProgress >= 100) {
                    clearInterval(holdTimer);
                    api.send('execute', { token: pendingToken, action: pendingAction });
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
            api.send('schedule', { token: pendingToken, action: pendingAction, seconds: 60 });
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
