export default {
    mount(container, api) {
        this.unmountFn = (() => {
    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'padding: 24px; display: flex; flex-direction: column; justify-content: center; height: 100%; box-sizing: border-box;';

    const topRow = document.createElement('div');
    topRow.style.cssText = 'display: flex; justify-content: center; align-items: center; gap: 24px; margin-bottom: 32px;';

    const createBtn = (icon, action, isHero = false) => {
        const btn = document.createElement('button');
        btn.innerHTML = icon;
        if (isHero) {
            btn.style.cssText = 'width: 96px; height: 96px; border-radius: 50%; background: var(--accent); color: var(--on-accent); border: none; display: flex; align-items: center; justify-content: center; box-shadow: 0 8px 24px rgba(47, 91, 255, 0.3); transition: transform 0.15s;';
        } else {
            btn.style.cssText = 'width: 64px; height: 64px; border-radius: 50%; background: var(--surface); color: var(--text); border: none; display: flex; align-items: center; justify-content: center; transition: transform 0.15s; box-shadow: 0 4px 12px rgba(0,0,0,0.1);';
        }
        btn.onclick = () => {
            btn.style.transform = 'scale(0.9)';
            setTimeout(() => btn.style.transform = 'scale(1)', 150);
            api.send('action', { key: action });
            if (navigator.vibrate) navigator.vibrate(10);
        };
        return btn;
    };

    const prev = createBtn('<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="19 20 9 12 19 4 19 20"></polygon><line x1="5" y1="19" x2="5" y2="5"></line></svg>', 'PREV');
    const play = createBtn('<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>', 'PLAY_PAUSE', true);
    const next = createBtn('<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 4 15 12 5 20 5 4"></polygon><line x1="19" y1="5" x2="19" y2="19"></line></svg>', 'NEXT');

    topRow.appendChild(prev);
    topRow.appendChild(play);
    topRow.appendChild(next);

    const bottomRow = document.createElement('div');
    bottomRow.style.cssText = 'display: flex; justify-content: center; align-items: center; gap: 24px;';

    const volDown = createBtn('<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="15" y1="12" x2="21" y2="12"></line></svg>', 'VOL_DOWN');
    const mute = createBtn('<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg>', 'MUTE');
    const volUp = createBtn('<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>', 'VOL_UP');

    bottomRow.appendChild(volDown);
    bottomRow.appendChild(mute);
    bottomRow.appendChild(volUp);

    wrapper.appendChild(topRow);
    wrapper.appendChild(bottomRow);

    container.appendChild(wrapper);

    return () => {};
        })();
    },
    unmount() { if (this.unmountFn) this.unmountFn(); }
};
