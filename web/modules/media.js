export default {
    id: 'media',
    name: 'Media',
    icon: '🎵',
    
    mount(el, api) {
        this.el = el;
        
        el.innerHTML = `
            <div style="padding: 20px; background: #222; border-radius: 8px; display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 15px;">
                <button class="med-btn" data-key="PREV" style="padding: 30px 10px; font-size: 24px; border: none; border-radius: 8px; background: #444; color: white;">⏮</button>
                <button class="med-btn" data-key="PLAY_PAUSE" style="padding: 30px 10px; font-size: 24px; border: none; border-radius: 8px; background: #4caf50; color: white;">⏯</button>
                <button class="med-btn" data-key="NEXT" style="padding: 30px 10px; font-size: 24px; border: none; border-radius: 8px; background: #444; color: white;">⏭</button>
                
                <button class="med-btn" data-key="VOL_DOWN" style="padding: 30px 10px; font-size: 24px; border: none; border-radius: 8px; background: #444; color: white;">🔉</button>
                <button class="med-btn" data-key="MUTE" style="padding: 30px 10px; font-size: 24px; border: none; border-radius: 8px; background: #ff9800; color: white;">🔇</button>
                <button class="med-btn" data-key="VOL_UP" style="padding: 30px 10px; font-size: 24px; border: none; border-radius: 8px; background: #444; color: white;">🔊</button>
            </div>
        `;
        
        el.querySelectorAll('.med-btn').forEach(btn => {
            btn.onclick = () => {
                api.send('action', { key: btn.getAttribute('data-key') });
            };
        });
    },
    
    unmount() {
        if (this.el) this.el.innerHTML = '';
    }
};
