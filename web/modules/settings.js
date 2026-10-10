export default {
    mount(container, api) {
        this.unmountFn = (() => {
    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'padding: 24px; color: var(--text); padding-top: 80px;';
    
    const h1 = document.createElement('h1');
    h1.textContent = 'Settings';
    h1.style.cssText = 'margin-bottom: 32px; font-size: 2rem;';
    wrapper.appendChild(h1);

    const createSection = (title) => {
        const sec = document.createElement('div');
        sec.style.cssText = 'margin-bottom: 32px;';
        const h3 = document.createElement('h3');
        h3.textContent = title;
        h3.style.cssText = 'margin-bottom: 16px; color: var(--muted); font-size: 0.9rem; text-transform: uppercase; letter-spacing: 0.05em;';
        sec.appendChild(h3);
        return sec;
    };

    // Appearance
    const appearance = createSection('Appearance');
    const themeSelect = document.createElement('select');
    themeSelect.style.cssText = 'width: 100%; padding: 16px; border-radius: 18px; background: var(--surface); color: var(--text); border: none; font-size: 1.1rem; outline: none; appearance: none; font-weight: 500;';
    const themes = ['Dark', 'Light', 'System'];
    themes.forEach(t => {
        const opt = document.createElement('option');
        opt.value = t.toLowerCase();
        opt.textContent = t;
        themeSelect.appendChild(opt);
    });
    
    themeSelect.value = localStorage.getItem('app-theme') || 'system';
    themeSelect.onchange = (e) => {
        const val = e.target.value;
        localStorage.setItem('app-theme', val);
        const isDark = val === 'dark' || (val === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
        if (isDark) {
            document.documentElement.removeAttribute('data-theme');
            document.getElementById('meta-theme-color').content = '#0A0D14';
        } else {
            document.documentElement.setAttribute('data-theme', 'light');
            document.getElementById('meta-theme-color').content = '#EEF1F6';
        }
    };
    appearance.appendChild(themeSelect);
    wrapper.appendChild(appearance);

    // Haptics
    const haptics = createSection('Feedback');
    const hapticsBtn = document.createElement('button');
    const isHapticsOn = (localStorage.getItem('app-haptics') || 'on') === 'on';
    hapticsBtn.textContent = 'Haptics: ' + (isHapticsOn ? 'On' : 'Off');
    hapticsBtn.style.cssText = 'width: 100%; padding: 16px; border-radius: 18px; background: var(--surface); color: var(--text); border: none; font-size: 1.1rem; text-align: left; font-weight: 500; display:flex; justify-content:space-between; align-items:center;';
    
    const toggleHaptics = () => {
        const current = localStorage.getItem('app-haptics') || 'on';
        const next = current === 'on' ? 'off' : 'on';
        localStorage.setItem('app-haptics', next);
        hapticsBtn.textContent = 'Haptics: ' + (next === 'on' ? 'On' : 'Off');
        if (next === 'on' && navigator.vibrate) navigator.vibrate(10);
    };
    hapticsBtn.onclick = toggleHaptics;
    haptics.appendChild(hapticsBtn);
    wrapper.appendChild(haptics);

    // Touchpad
    const touchpad = createSection('Touchpad');
    const speedSelect = document.createElement('select');
    speedSelect.style.cssText = 'width: 100%; padding: 16px; border-radius: 18px; background: var(--surface); color: var(--text); border: none; font-size: 1.1rem; outline: none; appearance: none; font-weight: 500;';
    const speeds = [
        {l: 'Slow', v: '0.5'},
        {l: 'Normal', v: '1.0'},
        {l: 'Fast', v: '1.5'},
        {l: 'Very Fast', v: '2.0'}
    ];
    speeds.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.v;
        opt.textContent = 'Speed: ' + s.l;
        speedSelect.appendChild(opt);
    });
    speedSelect.value = localStorage.getItem('app-touchpad-speed') || '1.0';
    speedSelect.onchange = (e) => {
        localStorage.setItem('app-touchpad-speed', e.target.value);
    };
    touchpad.appendChild(speedSelect);
    wrapper.appendChild(touchpad);

    // Server
    const serverInfo = createSection('Connection');
    const addr = document.createElement('div');
    addr.style.cssText = 'width: 100%; padding: 16px; border-radius: 18px; background: var(--surface); color: var(--muted); border: none; font-size: 1rem; font-family: var(--font-mono);';
    addr.textContent = 'Server: ' + window.location.host;
    serverInfo.appendChild(addr);
    wrapper.appendChild(serverInfo);

    container.appendChild(wrapper);
    return () => {};
        })();
    },
    unmount() { if (this.unmountFn) this.unmountFn(); }
};
