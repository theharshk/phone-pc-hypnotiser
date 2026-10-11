import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// Helper simulating localStorage with try/catch
function createMockStorage() {
    let store = {};
    return {
        getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
        setItem(k, v) { store[k] = String(v); },
        removeItem(k) { delete store[k]; },
        clear() { store = {}; }
    };
}

describe('Theme and Bedside Mode Settings', () => {
    test('default theme is dark', () => {
        const storage = createMockStorage();
        const theme = storage.getItem('pr_theme') || 'dark';
        assert.equal(theme, 'dark');
    });

    test('settings choice dark / light / system is persisted', () => {
        const storage = createMockStorage();
        ['dark', 'light', 'system'].forEach(choice => {
            storage.setItem('pr_theme', choice);
            assert.equal(storage.getItem('pr_theme'), choice);
        });
    });

    test('system theme resolves based on media query', () => {
        const resolveEffectiveTheme = (choice, systemPrefersLight) => {
            if (choice === 'system') return systemPrefersLight ? 'light' : 'dark';
            return choice;
        };

        assert.equal(resolveEffectiveTheme('system', true), 'light');
        assert.equal(resolveEffectiveTheme('system', false), 'dark');
        assert.equal(resolveEffectiveTheme('dark', true), 'dark');
        assert.equal(resolveEffectiveTheme('light', false), 'light');
    });

    test('bedside mode setting toggles and persists', () => {
        const storage = createMockStorage();
        assert.equal(storage.getItem('pr_bedside') === 'true', false);

        storage.setItem('pr_bedside', 'true');
        assert.equal(storage.getItem('pr_bedside') === 'true', true);

        storage.setItem('pr_bedside', 'false');
        assert.equal(storage.getItem('pr_bedside') === 'true', false);
    });

    test('localStorage operations are resilient to storage exceptions', () => {
        const failingStorage = {
            getItem() { throw new Error('QuotaExceeded / SecurityError'); },
            setItem() { throw new Error('QuotaExceeded / SecurityError'); }
        };

        const safeGet = (k, fb) => {
            try { return failingStorage.getItem(k) ?? fb; } catch (e) { return fb; }
        };
        const safeSet = (k, v) => {
            try { failingStorage.setItem(k, v); return true; } catch (e) { return false; }
        };

        assert.equal(safeGet('pr_theme', 'dark'), 'dark');
        assert.equal(safeSet('pr_theme', 'light'), false);
    });
});

describe('Hash Router Logic', () => {
    test('root or empty hash routes to home', () => {
        const resolveRoute = (hash) => {
            const r = (hash || '').replace(/^#/, '');
            return (!r || r === 'home') ? 'home' : r;
        };

        assert.equal(resolveRoute(''), 'home');
        assert.equal(resolveRoute('#'), 'home');
        assert.equal(resolveRoute('#home'), 'home');
    });

    test('settings hash routes to settings view', () => {
        const resolveRoute = (hash) => {
            const r = (hash || '').replace(/^#/, '');
            return (!r || r === 'home') ? 'home' : r;
        };

        assert.equal(resolveRoute('#settings'), 'settings');
    });

    test('module hashes route to appropriate module id', () => {
        const resolveRoute = (hash) => {
            const r = (hash || '').replace(/^#/, '');
            return (!r || r === 'home') ? 'home' : r;
        };

        assert.equal(resolveRoute('#touchpad'), 'touchpad');
        assert.equal(resolveRoute('#keyboard'), 'keyboard');
        assert.equal(resolveRoute('#screen'), 'screen');
        assert.equal(resolveRoute('#power'), 'power');
        assert.equal(resolveRoute('#media'), 'media');
    });
});

describe('Touchpad Speed Sensitivity', () => {
    test('speed multiplier scales delta movements correctly', () => {
        const calculateScaledMove = (dx, dy, rawSpeed) => {
            const speed = (!isNaN(rawSpeed) && rawSpeed > 0) ? rawSpeed : 1.0;
            return {
                dx: Math.round(dx * speed),
                dy: Math.round(dy * speed)
            };
        };

        // Default 1.0
        assert.deepEqual(calculateScaledMove(10, -5, 1.0), { dx: 10, dy: -5 });
        // Slow sensitivity 0.5 (-5 * 0.5 = -2.5 -> rounds to -2 in JS)
        assert.deepEqual(calculateScaledMove(10, -5, 0.5), { dx: 5, dy: -2 });
        // High sensitivity 2.0
        assert.deepEqual(calculateScaledMove(10, -5, 2.0), { dx: 20, dy: -10 });
        // Invalid or NaN falls back to 1.0
        assert.deepEqual(calculateScaledMove(10, -5, NaN), { dx: 10, dy: -5 });
    });
});

describe('Keyboard Modifier States', () => {
    test('toggling cycles through 0 (inactive) -> 1 (armed) -> 2 (locked) -> 0', () => {
        let state = 0;
        const toggle = (s) => (s + 1) % 3;

        state = toggle(state);
        assert.equal(state, 1); // armed
        state = toggle(state);
        assert.equal(state, 2); // locked
        state = toggle(state);
        assert.equal(state, 0); // inactive
    });

    test('armed modifiers clear after action while locked modifiers stay locked', () => {
        const mods = { ctrl: 1, alt: 2, shift: 0, win: 0 };
        const clearArmed = (m) => {
            for (const k in m) {
                if (m[k] === 1) m[k] = 0;
            }
        };

        clearArmed(mods);
        assert.equal(mods.ctrl, 0); // armed was cleared
        assert.equal(mods.alt, 2);  // locked was preserved
        assert.equal(mods.shift, 0);
    });
});

describe('Session Disconnect / Logout', () => {
    test('forget device clears pr_token, pr_device_id, and pr_layout', () => {
        const storage = createMockStorage();
        storage.setItem('pr_token', 'test-token-123');
        storage.setItem('pr_device_id', 'device-abc-456');
        storage.setItem('pr_layout', '["touchpad","keyboard"]');

        const disconnectSession = (s) => {
            s.removeItem('pr_token');
            s.removeItem('pr_device_id');
            s.removeItem('pr_layout');
        };

        disconnectSession(storage);
        assert.equal(storage.getItem('pr_token'), null);
        assert.equal(storage.getItem('pr_device_id'), null);
        assert.equal(storage.getItem('pr_layout'), null);
    });

    test('disconnect dispatches unpair message with deviceId before clearing storage', () => {
        const sentMessages = [];
        const mockWs = {
            readyState: 1, // OPEN
            send(data) { sentMessages.push(JSON.parse(data)); }
        };
        const storage = createMockStorage();
        storage.setItem('pr_token', 'test-token-123');
        storage.setItem('pr_device_id', 'device-abc-456');

        const disconnectWithUnpair = (ws, s) => {
            const deviceId = s.getItem('pr_device_id');
            if (ws && ws.readyState === 1) {
                ws.send(JSON.stringify({ m: 'core', t: 'unpair', d: { deviceId: deviceId || '' } }));
            }
            s.removeItem('pr_token');
            s.removeItem('pr_device_id');
            s.removeItem('pr_layout');
        };

        disconnectWithUnpair(mockWs, storage);
        assert.equal(sentMessages.length, 1);
        assert.deepEqual(sentMessages[0], {
            m: 'core',
            t: 'unpair',
            d: { deviceId: 'device-abc-456' }
        });
        assert.equal(storage.getItem('pr_token'), null);
        assert.equal(storage.getItem('pr_device_id'), null);
    });
});

describe('Header Theme Toggle (Moon/Sun Icon)', () => {
    test('toggling switches between dark and light themes', () => {
        const toggleTheme = (current) => (current === 'dark' ? 'light' : 'dark');

        assert.equal(toggleTheme('dark'), 'light');
        assert.equal(toggleTheme('light'), 'dark');
    });
});

describe('Virtual Key Resolution for Shortcuts', () => {
    test('resolves single characters to Windows virtual key codes', () => {
        const resolveVirtualKey = (codeStr, specialKeysMap = {}) => {
            if (specialKeysMap[codeStr]) return specialKeysMap[codeStr];
            if (codeStr && codeStr.length === 1) {
                const c = codeStr.toUpperCase().charCodeAt(0);
                if ((c >= 65 && c <= 90) || (c >= 48 && c <= 57) || c === 32) {
                    return c;
                }
            }
            return null;
        };

        const specialMap = { 'Enter': 13, 'Escape': 27, 'Win': 91 };

        // Alphanumeric keys
        assert.equal(resolveVirtualKey('r', specialMap), 82); // VK_R
        assert.equal(resolveVirtualKey('R', specialMap), 82);
        assert.equal(resolveVirtualKey('a', specialMap), 65); // VK_A
        assert.equal(resolveVirtualKey('c', specialMap), 67); // VK_C
        assert.equal(resolveVirtualKey('1', specialMap), 49); // VK_1

        // Special keys
        assert.equal(resolveVirtualKey('Enter', specialMap), 13);
        assert.equal(resolveVirtualKey('Win', specialMap), 91);

        // Unknown multi-char
        assert.equal(resolveVirtualKey('UnknownKey', specialMap), null);
    });
});
