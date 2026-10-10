import { createUnifiedTouchpadAndKeyboard } from './touchpadUI.js';

export default {
    id: 'touchpad',
    name: 'Touchpad',
    icon: '👆',
    
    mount(el, api) {
        this.el = el;
        this.api = api;
        
        el.style.cssText = 'height:100%; width:100%; box-sizing:border-box; background:black;';
        this.cleanupUI = createUnifiedTouchpadAndKeyboard(this.el, this.api, false);
    },
    
    unmount() {
        if (this.cleanupUI) this.cleanupUI();
        if (this.el) this.el.innerHTML = '';
    }
};
