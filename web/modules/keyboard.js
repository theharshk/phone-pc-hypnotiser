import { createUnifiedTouchpadAndKeyboard } from './touchpadUI.js';

export default {
    id: 'keyboard',
    name: 'Keyboard',
    icon: '⌨️',
    
    mount(el, api) {
        this.el = el;
        this.api = api;
        
        el.innerHTML = `
            <div style="padding: 16px; padding-bottom: 90px; display:flex; flex-direction:column; height: 100%; box-sizing:border-box;">
                <div style="display: flex; gap: 8px; margin-bottom: 16px; flex-wrap: wrap;">
                    <button id="kb-ctrl" style="flex:1; padding: 12px; border: none; border-radius: 12px; font-weight:bold;">Ctrl</button>
                    <button id="kb-alt" style="flex:1; padding: 12px; border: none; border-radius: 12px; font-weight:bold;">Alt</button>
                    <button id="kb-shift" style="flex:1; padding: 12px; border: none; border-radius: 12px; font-weight:bold;">Shift</button>
                    <button id="kb-win" style="flex:1; padding: 12px; border: none; border-radius: 12px; font-weight:bold;">Win</button>
                </div>
                <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 16px;">
                    <button class="sp-key" data-key="Escape" style="padding:12px; border-radius:8px; border:none; background:rgba(255,255,255,0.1); color:white;">Esc</button>
                    <button class="sp-key" data-key="Tab" style="padding:12px; border-radius:8px; border:none; background:rgba(255,255,255,0.1); color:white;">Tab</button>
                    <button class="sp-key" data-key="Enter" style="padding:12px; border-radius:8px; border:none; background:var(--accent); color:white; font-weight:bold;">Enter</button>
                    <button class="sp-key" data-key="Backspace" style="padding:12px; border-radius:8px; border:none; background:rgba(255,255,255,0.1); color:white;">Bspc</button>
                    
                    <button class="sp-key" data-key="ArrowLeft" style="padding:12px; border-radius:8px; border:none; background:rgba(255,255,255,0.1); color:white;">&larr;</button>
                    <button class="sp-key" data-key="ArrowUp" style="padding:12px; border-radius:8px; border:none; background:rgba(255,255,255,0.1); color:white;">&uarr;</button>
                    <button class="sp-key" data-key="ArrowDown" style="padding:12px; border-radius:8px; border:none; background:rgba(255,255,255,0.1); color:white;">&darr;</button>
                    <button class="sp-key" data-key="ArrowRight" style="padding:12px; border-radius:8px; border:none; background:rgba(255,255,255,0.1); color:white;">&rarr;</button>
                </div>
            </div>
        `;
        
        const mods = { ctrl: 0, alt: 0, shift: 0, win: 0 }; // 0=inactive, 1=armed, 2=locked
        const updateModUI = (key) => {
            const btn = el.querySelector(`#kb-${key}`);
            const state = mods[key];
            btn.style.backgroundColor = state === 2 ? 'var(--danger)' : state === 1 ? '#ff9f0a' : 'rgba(255,255,255,0.15)';
            btn.style.color = state > 0 ? 'white' : 'var(--muted)';
        };
        
        ['ctrl', 'alt', 'shift', 'win'].forEach(k => {
            const btn = el.querySelector(`#kb-${k}`);
            btn.onclick = () => {
                mods[k] = (mods[k] + 1) % 3;
                updateModUI(k);
            };
            updateModUI(k);
        });
        
        const getModState = () => ({
            ctrl: mods.ctrl > 0,
            alt: mods.alt > 0,
            shift: mods.shift > 0,
            win: mods.win > 0
        });
        
        const clearArmedMods = () => {
            let changed = false;
            for (let k in mods) {
                if (mods[k] === 1) { mods[k] = 0; changed = true; }
            }
            if (changed) {
                ['ctrl', 'alt', 'shift', 'win'].forEach(updateModUI);
            }
        };
        
        el.querySelectorAll('.sp-key').forEach(btn => {
            btn.onclick = () => {
                const code = btn.getAttribute('data-key');
                api.send('key', { code, ...getModState(), action: 'press' });
                clearArmedMods();
            };
        });
        
        // Add footer and popup
        this.cleanupUI = createUnifiedTouchpadAndKeyboard(this.el, this.api, true);
    },
    
    unmount() {
        if (this.cleanupUI) this.cleanupUI();
        if (this.el) this.el.innerHTML = '';
    }
};
