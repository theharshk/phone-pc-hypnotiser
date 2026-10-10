export default {
    id: 'keyboard',
    name: 'Keyboard',
    icon: '⌨️',
    
    mount(el, api) {
        this.el = el;
        this.api = api;
        
        el.innerHTML = `
            <div style="padding: 10px; background: #222; border-radius: 8px;">
                <div style="display: flex; gap: 5px; margin-bottom: 10px; flex-wrap: wrap;">
                    <button id="kb-ctrl" style="flex:1; padding: 10px; border: none; border-radius: 4px;">Ctrl</button>
                    <button id="kb-alt" style="flex:1; padding: 10px; border: none; border-radius: 4px;">Alt</button>
                    <button id="kb-shift" style="flex:1; padding: 10px; border: none; border-radius: 4px;">Shift</button>
                    <button id="kb-win" style="flex:1; padding: 10px; border: none; border-radius: 4px;">Win</button>
                </div>
                <div style="display: flex; gap: 5px; margin-bottom: 10px; flex-wrap: wrap;">
                    <button class="sp-key" data-key="Escape" style="padding: 10px; flex: 1 1 20%;">Esc</button>
                    <button class="sp-key" data-key="Tab" style="padding: 10px; flex: 1 1 20%;">Tab</button>
                    <button class="sp-key" data-key="Enter" style="padding: 10px; flex: 1 1 20%;">Enter</button>
                    <button class="sp-key" data-key="Backspace" style="padding: 10px; flex: 1 1 20%;">Bspc</button>
                    <button class="sp-key" data-key="Delete" style="padding: 10px; flex: 1 1 20%;">Del</button>
                    <button class="sp-key" data-key="ArrowUp" style="padding: 10px; flex: 1 1 20%;">↑</button>
                    <button class="sp-key" data-key="ArrowDown" style="padding: 10px; flex: 1 1 20%;">↓</button>
                    <button class="sp-key" data-key="ArrowLeft" style="padding: 10px; flex: 1 1 20%;">←</button>
                    <button class="sp-key" data-key="ArrowRight" style="padding: 10px; flex: 1 1 20%;">→</button>
                    <button class="sp-key" data-key="Home" style="padding: 10px; flex: 1 1 20%;">Home</button>
                    <button class="sp-key" data-key="End" style="padding: 10px; flex: 1 1 20%;">End</button>
                    <button class="sp-key" data-key="PageUp" style="padding: 10px; flex: 1 1 20%;">PgUp</button>
                    <button class="sp-key" data-key="PageDown" style="padding: 10px; flex: 1 1 20%;">PgDn</button>
                </div>
                <div style="display: flex; gap: 5px; margin-bottom: 10px; flex-wrap: wrap;">
                    ${[1,2,3,4,5,6,7,8,9,10,11,12].map(i => `<button class="sp-key" data-key="F${i}" style="padding: 10px; flex: 1 1 20%;">F${i}</button>`).join('')}
                </div>
                <button id="kb-show" style="width: 100%; padding: 15px; background: #4caf50; color: white; border: none; border-radius: 4px; font-weight: bold;">Open Phone Keyboard</button>
                <input type="text" id="kb-input" style="opacity: 0; position: absolute; top: -1000px;" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" />
            </div>
        `;
        
        const mods = { ctrl: 0, alt: 0, shift: 0, win: 0 }; // 0=inactive, 1=armed, 2=locked
        const updateModUI = (key) => {
            const btn = el.querySelector(`#kb-${key}`);
            const state = mods[key];
            btn.style.backgroundColor = state === 2 ? '#f44336' : state === 1 ? '#ff9800' : '#444';
            btn.style.color = state > 0 ? 'white' : '#ccc';
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
        
        const input = el.querySelector('#kb-input');
        el.querySelector('#kb-show').onclick = () => {
            input.focus();
        };
        
        input.addEventListener('input', (e) => {
            const char = e.data;
            if (char) {
                api.send('text', { text: char });
                clearArmedMods();
            }
            input.value = '';
        });
        
        input.addEventListener('keydown', (e) => {
            if (e.key.length > 1) { // Special key
                e.preventDefault();
                api.send('key', { code: e.key, ...getModState(), action: 'press' });
                clearArmedMods();
            }
        });
    },
    
    unmount() {
        if (this.el) this.el.innerHTML = '';
    }
};
