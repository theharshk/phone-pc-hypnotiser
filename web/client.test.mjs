import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildStreamTextPayload, buildCancelStreamPayload, STREAM_SPEED_PRESETS, resolveStreamDelay } from './modules/touchpadUI.js';
import { calculateNormalizedTap, buildScreenTapPayload } from './modules/screen.js';

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

    test('pause status preserves pr_token and pr_device_id in storage', () => {
        const storage = createMockStorage();
        storage.setItem('pr_token', 'test-token-123');
        storage.setItem('pr_device_id', 'device-abc-456');

        const handleErrorMessage = (msg, s) => {
            if (msg.d && (msg.d.type === 'revoked' || msg.d.code === 'revoked')) {
                s.removeItem('pr_token');
                s.removeItem('pr_device_id');
            }
            // 'paused' preserves credentials
        };

        handleErrorMessage({ m: 'core', t: 'error', d: { code: 'paused' } }, storage);
        assert.equal(storage.getItem('pr_token'), 'test-token-123');
        assert.equal(storage.getItem('pr_device_id'), 'device-abc-456');
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

describe('Touchpad & Keyboard Input Events (Paste & Multi-char)', () => {
    test('extracts payload from insertText, insertFromPaste, and paste events', () => {
        const processInputEvent = (e, val) => {
            if ((e.inputType === 'insertText' || e.inputType === 'insertFromPaste' || e.inputType === 'insertCompositionText') && e.data) {
                return e.data;
            } else if (val) {
                return val;
            }
            return null;
        };

        const processPasteEvent = (e) => {
            if (e.clipboardData) return e.clipboardData.getData('text');
            return null;
        };

        // Regular typing
        assert.equal(processInputEvent({ inputType: 'insertText', data: 'a' }, ''), 'a');
        // Mobile paste via input event
        assert.equal(processInputEvent({ inputType: 'insertFromPaste', data: 'long pasted text' }, ''), 'long pasted text');
        // Direct value fallback
        assert.equal(processInputEvent({ inputType: 'unknown' }, 'fallback value'), 'fallback value');
        // Native paste event with clipboardData
        const mockPasteEvent = {
            clipboardData: { getData: (type) => (type === 'text' ? 'clipboard multiline\ncontent' : '') }
        };
        assert.equal(processPasteEvent(mockPasteEvent), 'clipboard multiline\ncontent');
    });
});

describe('Streaming Text & Clipboard Paste Modal', () => {
    test('builds stream_text payload with multi-line paragraphs and special characters', () => {
        const text = 'Paragraph 1\n\nParagraph 2\twith indent.';
        const payload = buildStreamTextPayload(text);
        assert.deepEqual(payload, {
            m: 'keyboard',
            t: 'stream_text',
            d: { text: 'Paragraph 1\n\nParagraph 2\twith indent.' }
        });
    });

    test('builds stream_text payload with default empty string when given null or undefined', () => {
        assert.deepEqual(buildStreamTextPayload(null), {
            m: 'keyboard',
            t: 'stream_text',
            d: { text: '' }
        });
    });

    test('builds cancel_stream payload for stopping active streaming', () => {
        const payload = buildCancelStreamPayload();
        assert.deepEqual(payload, {
            m: 'keyboard',
            t: 'cancel_stream',
            d: {}
        });
    });

    test('handles modal state transitions, streaming state, cancellation, and completion', () => {
        const sentMessages = [];
        let isStreaming = false;
        let isModalOpen = true;

        const fakeApi = {
            send: (type, data) => {
                sentMessages.push({ type, data });
            }
        };

        const handleTypeToPc = (text) => {
            if (!text || !text.trim()) return;
            isStreaming = true;
            fakeApi.send('stream_text', { text });
        };

        const handleStopStream = () => {
            fakeApi.send('cancel_stream', {});
            isStreaming = false;
            isModalOpen = false;
        };

        const handleWsEvent = (eventData) => {
            if (eventData.m === 'keyboard' && eventData.t === 'stream_done') {
                if (isStreaming) {
                    isStreaming = false;
                    isModalOpen = false;
                }
            }
        };

        // Blank submission should not trigger stream
        handleTypeToPc('   ');
        assert.equal(isStreaming, false);
        assert.equal(sentMessages.length, 0);

        // Valid submission starts streaming
        handleTypeToPc('Hello PC from Phone Clipboard');
        assert.equal(isStreaming, true);
        assert.equal(sentMessages.length, 1);
        assert.deepEqual(sentMessages[0], {
            type: 'stream_text',
            data: { text: 'Hello PC from Phone Clipboard' }
        });

        // Stopping active stream dispatches cancel_stream and closes modal
        handleStopStream();
        assert.equal(isStreaming, false);
        assert.equal(isModalOpen, false);
        assert.equal(sentMessages.length, 2);
        assert.deepEqual(sentMessages[1], {
            type: 'cancel_stream',
            data: {}
        });

        // Re-open and verify stream_done auto-completes and closes modal
        isModalOpen = true;
        handleTypeToPc('Another snippet\nSecond line');
        assert.equal(isStreaming, true);
        assert.equal(isModalOpen, true);

        // Server signals stream_done
        handleWsEvent({ m: 'keyboard', t: 'stream_done' });
        assert.equal(isStreaming, false);
        assert.equal(isModalOpen, false);
    });
});

describe('Streaming Typing Speed Settings (5 Presets)', () => {
    test('resolves character delay for all 5 presets', () => {
        assert.equal(resolveStreamDelay('turbo'), 5);
        assert.equal(resolveStreamDelay('world_record'), 55);
        assert.equal(resolveStreamDelay('pro'), 100);
        assert.equal(resolveStreamDelay('fast'), 160);
        assert.equal(resolveStreamDelay('human'), 215);
    });

    test('falls back to default 5 ms when preset is invalid, null, or undefined', () => {
        assert.equal(resolveStreamDelay(null), 5);
        assert.equal(resolveStreamDelay(undefined), 5);
        assert.equal(resolveStreamDelay('unknown_speed'), 5);
        assert.equal(resolveStreamDelay(''), 5);
    });

    test('accepts valid custom numeric delay values clamped safely', () => {
        assert.equal(resolveStreamDelay(50), 50);
        assert.equal(resolveStreamDelay(500), 500);
        assert.equal(resolveStreamDelay(1500), 1000); // Clamped max 1000
    });

    test('persists and restores all 5 speed options in storage with default fallback', () => {
        const storage = createMockStorage();

        // Default when not in storage
        const getSavedSpeed = (s) => s.getItem('pr_stream_speed') || 'turbo';
        assert.equal(getSavedSpeed(storage), 'turbo');
        assert.equal(resolveStreamDelay(getSavedSpeed(storage)), 5);

        const presets = ['turbo', 'world_record', 'pro', 'fast', 'human'];
        const expectedDelays = [5, 55, 100, 160, 215];

        presets.forEach((preset, idx) => {
            storage.setItem('pr_stream_speed', preset);
            const saved = storage.getItem('pr_stream_speed');
            assert.equal(saved, preset);
            assert.equal(resolveStreamDelay(saved), expectedDelays[idx]);
        });
    });

    test('builds stream_text payload with delayMs from preset name or direct number', () => {
        // With preset name
        const p1 = buildStreamTextPayload('Hello World', 'world_record');
        assert.deepEqual(p1, {
            m: 'keyboard',
            t: 'stream_text',
            d: { text: 'Hello World', delayMs: 55 }
        });

        // With pro preset
        const p2 = buildStreamTextPayload('Coding Snippet', 'pro');
        assert.deepEqual(p2, {
            m: 'keyboard',
            t: 'stream_text',
            d: { text: 'Coding Snippet', delayMs: 100 }
        });

        // With fast preset
        const p3 = buildStreamTextPayload('Fast text', 'fast');
        assert.deepEqual(p3, {
            m: 'keyboard',
            t: 'stream_text',
            d: { text: 'Fast text', delayMs: 160 }
        });

        // With average human preset
        const p4 = buildStreamTextPayload('Slow and steady', 'human');
        assert.deepEqual(p4, {
            m: 'keyboard',
            t: 'stream_text',
            d: { text: 'Slow and steady', delayMs: 215 }
        });

        // With direct number
        const p5 = buildStreamTextPayload('Direct number', 75);
        assert.deepEqual(p5, {
            m: 'keyboard',
            t: 'stream_text',
            d: { text: 'Direct number', delayMs: 75 }
        });

        // Without delayMs (backwards compatible)
        const p6 = buildStreamTextPayload('No delay specified');
        assert.deepEqual(p6, {
            m: 'keyboard',
            t: 'stream_text',
            d: { text: 'No delay specified' }
        });
    });

    test('dispatches stream_text with configured localStorage speed delay', () => {
        const storage = createMockStorage();
        storage.setItem('pr_stream_speed', 'human');

        const sentMessages = [];
        const sendMod = (m, t, d) => sentMessages.push({ m, t, d });

        const typeToPcAction = (text, s) => {
            const savedSpeed = s.getItem('pr_stream_speed') || 'turbo';
            const delayMs = resolveStreamDelay(savedSpeed);
            sendMod('keyboard', 'stream_text', { text, delayMs });
        };

        typeToPcAction('Pasted paragraph', storage);

        assert.equal(sentMessages.length, 1);
        assert.deepEqual(sentMessages[0], {
            m: 'keyboard',
            t: 'stream_text',
            d: { text: 'Pasted paragraph', delayMs: 215 }
        });
    });
});

describe('Device Approval & Stable Device ID Flow', () => {
    function generateDeviceId() {
        try {
            if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
                return crypto.randomUUID();
            }
        } catch (e) {}
        return 'dev-' + Math.random().toString(36).substring(2, 15) + '-' + Date.now().toString(36);
    }

    function initClientDeviceId(storage) {
        let id = storage.getItem('pr_device_id');
        if (!id) {
            id = generateDeviceId();
            storage.setItem('pr_device_id', id);
        }
        return id;
    }

    test('generates and persists stable device ID if missing in storage', () => {
        const storage = createMockStorage();
        assert.equal(storage.getItem('pr_device_id'), null);

        const id = initClientDeviceId(storage);
        assert.ok(id && id.length > 0);
        assert.equal(storage.getItem('pr_device_id'), id);
    });

    test('generates and persists stable device ID if empty string in storage', () => {
        const storage = createMockStorage();
        storage.setItem('pr_device_id', '');

        const id = initClientDeviceId(storage);
        assert.ok(id && id.length > 0);
        assert.equal(storage.getItem('pr_device_id'), id);
    });

    test('preserves existing stable device ID without overwriting', () => {
        const storage = createMockStorage();
        storage.setItem('pr_device_id', 'existing-uuid-1234');

        const id = initClientDeviceId(storage);
        assert.equal(id, 'existing-uuid-1234');
        assert.equal(storage.getItem('pr_device_id'), 'existing-uuid-1234');
    });

    test('revoked error clears token and regenerates fresh stable device ID', () => {
        const storage = createMockStorage();
        storage.setItem('pr_token', 'old-valid-token');
        storage.setItem('pr_device_id', 'old-device-id');

        const handleRevoked = (msg, s) => {
            if (msg.d && (msg.d.type === 'revoked' || msg.d.code === 'revoked')) {
                s.removeItem('pr_token');
                const freshId = generateDeviceId();
                s.setItem('pr_device_id', freshId);
            }
        };

        handleRevoked({ m: 'core', t: 'error', d: { type: 'revoked' } }, storage);
        assert.equal(storage.getItem('pr_token'), null);
        assert.ok(storage.getItem('pr_device_id'));
        assert.notEqual(storage.getItem('pr_device_id'), 'old-device-id');
    });

    test('hello message includes persisted stable device ID', () => {
        const storage = createMockStorage();
        const stableId = 'stable-device-uuid-999';
        storage.setItem('pr_device_id', stableId);
        storage.setItem('pr_token', '');

        const sentMessages = [];
        const mockWs = {
            send(data) { sentMessages.push(JSON.parse(data)); }
        };

        const onOpen = (ws, s) => {
            let token = s.getItem('pr_token') || '';
            let deviceId = s.getItem('pr_device_id') || '';
            if (!deviceId) {
                deviceId = generateDeviceId();
                s.setItem('pr_device_id', deviceId);
            }
            ws.send(JSON.stringify({
                m: 'core',
                t: 'hello',
                d: { deviceId, token, deviceName: 'TestAgent' }
            }));
        };

        onOpen(mockWs, storage);
        assert.equal(sentMessages.length, 1);
        assert.equal(sentMessages[0].d.deviceId, stableId);
    });

    test('heartbeat ping interval is started on ws open and cleared on cleanup', () => {
        let pingInterval = null;
        let pingsSent = 0;
        const mockWs = {
            readyState: 1,
            send(msg) {
                const parsed = JSON.parse(msg);
                if (parsed.t === 'ping') pingsSent++;
            }
        };

        const onOpen = () => {
            if (pingInterval) clearInterval(pingInterval);
            pingInterval = setInterval(() => {
                if (mockWs.readyState === 1) {
                    mockWs.send(JSON.stringify({ m: 'core', t: 'ping', i: Date.now() }));
                }
            }, 10);
        };

        const cleanup = () => {
            if (pingInterval) {
                clearInterval(pingInterval);
                pingInterval = null;
            }
        };

        onOpen();
        assert.ok(pingInterval !== null);

        return new Promise((resolve) => {
            setTimeout(() => {
                assert.ok(pingsSent >= 1, 'Pings should be sent while socket is open');
                cleanup();
                assert.equal(pingInterval, null);
                const countAfterCleanup = pingsSent;
                setTimeout(() => {
                    assert.equal(pingsSent, countAfterCleanup, 'No pings sent after cleanup');
                    resolve();
                }, 30);
            }, 30);
        });
    });

    test('pong message does not mark status connected when not yet authenticated', () => {
        let currentStatus = 'reconnecting';
        let currentStatusText = 'Waiting for approval...';

        const updateStatus = (state, text) => {
            currentStatus = state;
            currentStatusText = text;
        };

        const onPong = (isAuthenticated) => {
            if (isAuthenticated) {
                updateStatus('connected', 'Connected');
            }
        };

        // While unauthenticated (waiting for approval)
        onPong(false);
        assert.equal(currentStatus, 'reconnecting');
        assert.equal(currentStatusText, 'Waiting for approval...');

        // When authenticated
        onPong(true);
        assert.equal(currentStatus, 'connected');
        assert.equal(currentStatusText, 'Connected');
    });
});

describe('Screen Module Tap-to-Click & Cursor Positioning', () => {
    test('calculateNormalizedTap computes normalized 0..1 coordinates accurately', () => {
        const mockRect = { left: 100, top: 50, width: 800, height: 600 };
        // Center tap
        const center = calculateNormalizedTap(500, 350, mockRect);
        assert.equal(center.x, 0.5);
        assert.equal(center.y, 0.5);

        // Top-left tap
        const topLeft = calculateNormalizedTap(100, 50, mockRect);
        assert.equal(topLeft.x, 0.0);
        assert.equal(topLeft.y, 0.0);

        // Bottom-right tap
        const bottomRight = calculateNormalizedTap(900, 650, mockRect);
        assert.equal(bottomRight.x, 1.0);
        assert.equal(bottomRight.y, 1.0);
    });

    test('calculateNormalizedTap clamps coordinates safely when tapping outside bounding rect', () => {
        const mockRect = { left: 100, top: 100, width: 200, height: 200 };
        const clampedNegative = calculateNormalizedTap(50, 50, mockRect);
        assert.equal(clampedNegative.x, 0.0);
        assert.equal(clampedNegative.y, 0.0);

        const clampedPositive = calculateNormalizedTap(400, 500, mockRect);
        assert.equal(clampedPositive.x, 1.0);
        assert.equal(clampedPositive.y, 1.0);
    });

    test('calculateNormalizedTap handles invalid or zero rect gracefully', () => {
        assert.deepEqual(calculateNormalizedTap(10, 10, null), { x: 0, y: 0 });
        assert.deepEqual(calculateNormalizedTap(10, 10, { width: 0, height: 0 }), { x: 0, y: 0 });
    });

    test('buildScreenTapPayload constructs correct payload for left and right clicks', () => {
        const leftPayload = buildScreenTapPayload(0.25, 0.75, 'left');
        assert.deepEqual(leftPayload, {
            m: 'screen',
            t: 'tap',
            d: { x: 0.25, y: 0.75, button: 'left' }
        });

        const rightPayload = buildScreenTapPayload(0.6, 0.4, 'right');
        assert.deepEqual(rightPayload, {
            m: 'screen',
            t: 'tap',
            d: { x: 0.6, y: 0.4, button: 'right' }
        });
    });

    test('dispatches tap event to server api without referencing undeclared variables', () => {
        const sentMessages = [];
        const mockApi = {
            send: (type, data) => sentMessages.push({ type, data })
        };

        const mockRect = { left: 0, top: 0, width: 1000, height: 500 };

        // Simulating the corrected img.onclick without isRelativeMode ReferenceError
        const handleImageClick = (e, api, rect) => {
            const { x, y } = calculateNormalizedTap(e.clientX, e.clientY, rect);
            api.send('tap', { x, y, button: 'left' });
        };

        handleImageClick({ clientX: 250, clientY: 250 }, mockApi, mockRect);

        assert.equal(sentMessages.length, 1);
        assert.deepEqual(sentMessages[0], {
            type: 'tap',
            data: { x: 0.25, y: 0.5, button: 'left' }
        });
    });

    test('cursor positioning maps normalized coordinates to percentage offsets', () => {
        const cursorPositionStyle = (data) => ({
            left: `${data.x * 100}%`,
            top: `${data.y * 100}%`
        });

        const pos = cursorPositionStyle({ x: 0.45, y: 0.85 });
        assert.equal(pos.left, '45%');
        assert.equal(pos.top, '85%');
    });
});



