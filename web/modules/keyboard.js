import { createUnifiedTouchpadAndKeyboard } from './touchpadUI.js';

function triggerHaptic(duration = 25) {
    try {
        if (typeof window !== 'undefined' && typeof window.__pr_triggerHaptic === 'function') {
            window.__pr_triggerHaptic(duration);
            return;
        }
        if (localStorage.getItem('pr_haptics') === 'false') return;
        if (typeof navigator !== 'undefined' && navigator.vibrate) {
            navigator.vibrate(duration);
        }
    } catch (e) {}
}

const MOD_CONFIG = {
    ctrl: { code: 'Ctrl', label: 'Ctrl' },
    alt: { code: 'Alt', label: 'Alt' },
    shift: { code: 'Shift', label: 'Shift' },
    win: { code: 'Win', label: 'Win' }
};

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
                    <button id="kb-ctrl" class="kb-mod-btn" style="flex:1; padding: 12px; border-radius: 12px; font-weight:700; font-size:15px; min-height:48px; min-width:0;">Ctrl</button>
                    <button id="kb-alt" class="kb-mod-btn" style="flex:1; padding: 12px; border-radius: 12px; font-weight:700; font-size:15px; min-height:48px; min-width:0;">Alt</button>
                    <button id="kb-shift" class="kb-mod-btn" style="flex:1; padding: 12px; border-radius: 12px; font-weight:700; font-size:15px; min-height:48px; min-width:0;">Shift</button>
                    <button id="kb-win" class="kb-mod-btn" style="flex:1; padding: 12px; border-radius: 12px; font-weight:700; font-size:15px; min-height:48px; min-width:0;">Win</button>
                </div>
                <div style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; margin-bottom: 16px;">
                    <button class="sp-key" data-key="Escape" style="padding:12px; border-radius:12px; border:1px solid var(--border); background:var(--card); color:var(--text); font-weight:600; min-height:48px; min-width:0;">Esc</button>
                    <button class="sp-key" data-key="Tab" style="padding:12px; border-radius:12px; border:1px solid var(--border); background:var(--card); color:var(--text); font-weight:600; min-height:48px; min-width:0;">Tab</button>
                    <button class="sp-key" data-key="Enter" style="padding:12px; border-radius:12px; border:1px solid var(--accent); background:var(--accent); color:#FFFFFF; font-weight:700; min-height:48px; min-width:0;">Enter</button>
                    <button class="sp-key" data-key="Backspace" style="padding:12px; border-radius:12px; border:1px solid var(--border); background:var(--card); color:var(--text); font-weight:600; min-height:48px; min-width:0;">Bspc</button>
                    
                    <button class="sp-key" data-key="ArrowLeft" style="padding:12px; border-radius:12px; border:1px solid var(--border); background:var(--card); color:var(--text); font-weight:600; min-height:48px; min-width:0;">&larr;</button>
                    <button class="sp-key" data-key="ArrowUp" style="padding:12px; border-radius:12px; border:1px solid var(--border); background:var(--card); color:var(--text); font-weight:600; min-height:48px; min-width:0;">&uarr;</button>
                    <button class="sp-key" data-key="ArrowDown" style="padding:12px; border-radius:12px; border:1px solid var(--border); background:var(--card); color:var(--text); font-weight:600; min-height:48px; min-width:0;">&darr;</button>
                    <button class="sp-key" data-key="ArrowRight" style="padding:12px; border-radius:12px; border:1px solid var(--border); background:var(--card); color:var(--text); font-weight:600; min-height:48px; min-width:0;">&rarr;</button>
                </div>
            </div>
        `;
        
        this.mods = { ctrl: 0, alt: 0, shift: 0, win: 0 }; // 0=inactive, 1=armed, 2=locked
        const mods = this.mods;

        const updateModUI = (key) => {
            const btn = el.querySelector(`#kb-${key}`);
            if (!btn) return;
            const state = mods[key];
            if (state === 2) {
                // Locked -> accent interaction color with white text
                btn.style.backgroundColor = 'var(--accent)';
                btn.style.color = '#FFFFFF';
                btn.style.border = '1px solid var(--accent)';
            } else if (state === 1) {
                // Armed -> warning color with high contrast text
                btn.style.backgroundColor = 'var(--warning)';
                btn.style.color = '#11141C';
                btn.style.border = '1px solid var(--warning)';
            } else {
                // Inactive -> theme card color with text color
                btn.style.backgroundColor = 'var(--card)';
                btn.style.color = 'var(--text)';
                btn.style.border = '1px solid var(--border)';
            }
        };

        const toggleModifier = (k) => {
            triggerHaptic(20);
            const prev = mods[k];
            const next = (prev + 1) % 3;
            mods[k] = next;
            updateModUI(k);

            const code = MOD_CONFIG[k].code;
            if (next === 1 || next === 2) {
                api.send('key', { code, action: 'down' });
            } else if (prev !== 0) {
                api.send('key', { code, action: 'up' });
            }
        };

        ['ctrl', 'alt', 'shift', 'win'].forEach(k => {
            const btn = el.querySelector(`#kb-${k}`);
            if (!btn) return;
            let lastToggleTime = 0;
            const handleModEvent = (e) => {
                e.preventDefault();
                const now = Date.now();
                if (now - lastToggleTime < 250) return;
                lastToggleTime = now;
                toggleModifier(k);
            };
            btn.addEventListener('touchstart', handleModEvent, { passive: false });
            btn.addEventListener('mousedown', handleModEvent);
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
                if (mods[k] === 1) {
                    mods[k] = 0;
                    api.send('key', { code: MOD_CONFIG[k].code, action: 'up' });
                    changed = true;
                }
            }
            if (changed) {
                ['ctrl', 'alt', 'shift', 'win'].forEach(updateModUI);
            }
        };

        el.querySelectorAll('.sp-key').forEach(btn => {
            let lastPressTime = 0;
            const handlePress = (e) => {
                e.preventDefault();
                const now = Date.now();
                if (now - lastPressTime < 250) return;
                lastPressTime = now;
                triggerHaptic(20);
                const code = btn.getAttribute('data-key');
                api.send('key', { code, ...getModState(), action: 'press' });
                clearArmedMods();
            };
            btn.addEventListener('touchstart', handlePress, { passive: false });
            btn.addEventListener('mousedown', handlePress);
        });

        // Add footer and popup, wired to modifier handlers
        this.cleanupUI = createUnifiedTouchpadAndKeyboard(this.el, this.api, true, {
            getMods: getModState,
            onCharSent: clearArmedMods
        });
    },
    
    unmount() {
        if (this.mods && this.api) {
            for (const k of ['ctrl', 'alt', 'shift', 'win']) {
                if (this.mods[k] > 0) {
                    this.api.send('key', { code: MOD_CONFIG[k].code, action: 'up' });
                    this.mods[k] = 0;
                }
            }
        }
        if (this.cleanupUI) this.cleanupUI();
        if (this.el) this.el.innerHTML = '';
    }
};
