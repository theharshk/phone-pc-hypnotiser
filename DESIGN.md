# DESIGN.md: Phone-to-PC Remote Control (Java)

A self-hosted alternative to Unified Remote. A **Java (Spring Boot)** server runs on a Windows laptop. The phone uses a browser web app (PWA) over WiFi. Internet access comes later.

> **Instructions for AI agents:** Read this file before every task. Build **one step at a time** (section 16). Stop after each step and say how to test it. Do not implement features outside the current step. Keep OS-specific code inside `adapter/` only. Never pass client-supplied strings to a shell.

---

## 1. Overview

The phone opens a web page served by the laptop. The page keeps one WebSocket open to the server. The server turns messages into mouse, keyboard, media and power actions, and streams the screen back as JPEG frames.

### 1.1 Goals

- Control the laptop from bed: touchpad, keyboard, media, power, live screen view.
- Setup in under two minutes: run the server, scan a QR code, done.
- Optional 6-digit PIN, entered once per phone; the phone is then remembered.
- Modular: remotes are modules that can be added or removed without touching core code.
- Input latency under 50 ms on home WiFi.
- Portfolio quality: tested, documented, and explainable in an interview.

### 1.2 Non-goals for v1

Internet access (v2), gamepad (v3), macOS/Linux support (designed for, not built), multi-user permissions.

---

## 2. Tech Stack

| Area | Choice |
|---|---|
| Language | Java 17 or newer (21 preferred for virtual threads) |
| Framework | Spring Boot 3.x (Web, WebSocket) |
| Build | Maven |
| Input | `java.awt.Robot` plus **JNA** for what Robot cannot do |
| Screen capture | `Robot.createScreenCapture`, `ImageIO` for JPEG |
| JSON | Jackson |
| Password hashing | Spring Security Crypto (BCrypt or SCrypt); no full Spring Security needed |
| QR code | ZXing |
| mDNS (optional) | JmDNS |
| Tray icon | `java.awt.SystemTray` |
| Packaging | `jpackage` (bundled runtime, Windows installer) |
| Tests | JUnit 5, Mockito, Spring Boot Test |
| CI | GitHub Actions |
| Frontend | Plain HTML/CSS/JS, no build step, mobile-first, dark theme |

---

## 3. Requirements

### 3.1 Functional

| ID | Requirement |
|---|---|
| F1 | Touchpad: move, tap click, two-finger right click, two-finger scroll, tap-hold drag |
| F2 | Keyboard: live typing from the phone keyboard, special keys, sticky modifiers |
| F3 | Media: play/pause, next, previous, volume up/down, mute |
| F4 | Power: shutdown, restart, sleep, hibernate, lock, each with confirmation |
| F5 | Screen view: live frames, adjustable quality and scale, tap-to-click mapping |
| F6 | Home screen of module tiles; add, remove, reorder; layout persisted |
| F7 | Optional PIN, device pairing, trusted device list with revoke |
| F8 | Auto-reconnect and a visible connection status |

### 3.2 Non-functional

| Area | Target |
|---|---|
| Input latency | Under 50 ms on LAN (p95) |
| Screen view | 5 to 10 fps at roughly 720p, modest CPU use |
| Idle cost | Near zero CPU with no client connected or with the screen module closed |
| Security | No unauthenticated action executes; PIN never stored in plain text |
| Reliability | Survives WiFi drops and phone sleep; reconnects without re-pairing |
| Portability | OS-specific code isolated behind adapter interfaces |

---

## 4. Architecture

```
   PHONE (browser / PWA)                     LAPTOP (Windows, Java)
 +--------------------------+          +-----------------------------------+
 | App shell + module host  |  HTTP    | Spring Boot                       |
 | Panels: touchpad, kbd,   |<-------->|  - static files (web/)            |
 | media, power, screen     | WebSocket|  - /ws  WebSocket handler         |
 | Device token, layout     |<========>|  - /admin (loopback only)         |
 +--------------------------+          |                                   |
                                       | Auth: PIN hash, tokens, lockout   |
                                       | ModuleRegistry                    |
                                       |  touchpad|keyboard|media|power|    |
                                       |  screen                           |
                                       | Adapters (OS access)              |
                                       |  Robot + JNA, ImageIO, Process    |
                                       | ConfigStore (JSON file)           |
                                       +-----------------------------------+
```

Principles:

- **One WebSocket** for everything: one auth check, one reconnect path.
- **The server is the only trusted component.** The phone is untrusted; validate every message.
- **Adapters isolate the OS.** Modules never call Robot or JNA directly.
- **Modules are isolated** and discovered through a registry.

### 4.1 Package layout

```
phone-remote/
  docs/DESIGN.md
  web/                                 phone client (served by Spring)
    index.html  app.js  host.js  style.css  manifest.json  sw.js
    modules/  touchpad.js keyboard.js media.js power.js screen.js
  server/
    pom.xml
    src/main/java/com/phoneremote/
      App.java                         entry point (headless=false)
      config/    ConfigStore, AppConfig, DeviceRecord
      auth/      AuthService, PinService, TokenService, RateLimiter
      ws/        RemoteSocketHandler, Session, Envelope, MessageValidator
      module/    RemoteModule, ModuleRegistry
      module/impl/ TouchpadModule, KeyboardModule, MediaModule,
                   PowerModule, ScreenModule
      adapter/   InputAdapter, ScreenAdapter, PowerAdapter
      adapter/windows/ RobotInputAdapter, JnaKeyboard, GdiScreenAdapter,
                       WindowsPowerAdapter
      adapter/fake/    FakeInputAdapter, FakeScreenAdapter, FakePowerAdapter
      admin/     AdminController (loopback only)
      net/       NetworkInfo, QrService, MdnsService
      tray/      TrayService
    src/test/java/com/phoneremote/...
  README.md
```

### 4.2 Threading model

- Spring's WebSocket layer handles I/O.
- **Input injection** is quick; run it on a single-threaded executor per session so ordering is preserved.
- **Screen capture and JPEG encoding** are CPU-bound; run them on a dedicated thread (or virtual thread) per streaming session, feeding a bounded `ArrayBlockingQueue`. The WebSocket sender drains it.
- **Power commands** run through `ProcessBuilder` after the acknowledgement has been sent.

---

## 5. Protocol

One WebSocket at `/ws`. Text frames carry JSON; binary frames carry screen images.

### 5.1 Envelope

```json
{ "m": "touchpad", "t": "move", "d": { "dx": 4, "dy": -2 } }
```

| Field | Meaning |
|---|---|
| `m` | Module id, or `core` for system messages |
| `t` | Message type within the module |
| `d` | Payload |
| `i` | Optional request id, echoed in the reply |

High-frequency messages may use a compact array form such as `["m",4,-2]` to cut parsing cost.

### 5.2 Core messages

| Direction | Type | Purpose |
|---|---|---|
| C to S | `hello` | Device id, token (if any), protocol version, device name |
| S to C | `need_pin` | No valid token; ask for the PIN |
| C to S | `pin` | PIN attempt |
| S to C | `paired` | Token issued (sent once) |
| S to C | `pending_approval` | No-PIN mode; waiting for approval on the laptop |
| S to C | `ready` | Authenticated; includes module list and capabilities |
| S to C | `error` | Code plus message (`bad_pin`, `locked_out`, `revoked`, `upgrade_required`) |
| both | `ping` / `pong` | Heartbeat every 10 s; also gives latency |
| C to S | `open` / `close` | Start or stop a module (`d.module`) |

### 5.3 Binary screen frame

8-byte header, then JPEG bytes:

| Bytes | Content |
|---|---|
| 0 | Frame type (1 = JPEG) |
| 1 | Monitor index |
| 2-3 | Width (uint16) |
| 4-5 | Height (uint16) |
| 6-7 | Sequence number (uint16) |

The client sends `screen/ack` with the sequence number. The server keeps at most **2 unacknowledged frames** in flight.

### 5.4 Versioning

`hello` carries a protocol version. A mismatch returns `error: upgrade_required`, which matters because PWAs cache old JavaScript.

---

## 6. Module System

### 6.1 Server contract

```java
public interface RemoteModule {
    String id();                         // "touchpad"
    String displayName();
    default void onOpen(Session s) {}
    void onMessage(Session s, String type, JsonNode data);
    default void onClose(Session s) {}   // release held keys/buttons, stop captures
}
```

Each module is a Spring `@Component`. `ModuleRegistry` collects `List<RemoteModule>` and routes messages by `id()`. Adding a module means adding one class (and one JS file).

### 6.2 Client contract

```js
export default {
  id: 'touchpad', name: 'Touchpad', icon: '🖱️',
  mount(el, api) {},   // api.send(type, data), api.on(type, fn)
  unmount() {},
};
```

### 6.3 Lifecycle

1. The phone opens a tile and sends `core/open` with the module id.
2. The server calls `onOpen`; heavy modules (screen) start work now.
3. Messages flow under the module's namespace.
4. On close, hidden tab or disconnect, the server calls `onClose` and **releases every held key and mouse button**.

### 6.4 Layout persistence

Tile set and order are saved per device in the server config and cached in `localStorage` on the phone for an instant first render.

---

## 7. Adapter Layer

```java
public interface InputAdapter {
    void moveRelative(int dx, int dy);
    void moveAbsolute(int x, int y);
    void mouseDown(MouseButton b);
    void mouseUp(MouseButton b);
    void scroll(int amount);
    void keyDown(int keyCode);
    void keyUp(int keyCode);
    void typeText(String text);
    void mediaKey(MediaKey key);
}

public interface ScreenAdapter {
    List<MonitorInfo> monitors();
    BufferedImage capture(int monitorIndex);
}

public interface PowerAdapter {
    void shutdown(); void restart(); void sleep();
    void hibernate(); void lock(); void cancelPending();
}
```

| Adapter | Windows implementation |
|---|---|
| Input | `java.awt.Robot` for mouse and basic keys; JNA `SendInput`/`keybd_event` for media keys, Win key and Unicode |
| Screen | `Robot.createScreenCapture` first; JNA GDI `BitBlt` if too slow |
| Power | `ProcessBuilder` with fixed commands |

**Fake adapters** record calls and do nothing. All tests use them, so CI never moves a real mouse or shuts down a machine. A Spring profile (`test`) swaps them in.

---

## 8. Module Designs

### 8.1 Touchpad

- The client converts touches to deltas and batches them up to 60 Hz (accumulate dx/dy per animation frame).
- The server applies a sensitivity multiplier and acceleration curve, then moves the cursor.
- Gestures are resolved on the client: tap = left click, two-finger tap = right click, two-finger drag = scroll, tap then hold within 300 ms = drag.
- `onClose` releases the left button.

Java notes:
- `Robot` only has absolute `mouseMove(x, y)`. Track the pointer position yourself, add the delta, clamp to screen bounds, then move. Re-sync with `MouseInfo.getPointerInfo()` occasionally, not on every move.
- Call `setAutoDelay(0)` and `setAutoWaitForIdle(false)`; the defaults can add latency.

### 8.2 Keyboard

- A hidden `<input>` opens the phone keyboard. Use `beforeinput`/`input` for characters and `keydown` for special keys.
- Special-key bar: Esc, Tab, Enter, Backspace, Delete, arrows, Home/End, PgUp/PgDn, F1-F12.
- Sticky modifiers (Ctrl, Alt, Shift, Win): tap to arm for the next key, double-tap to lock. The server presses, taps, then releases in order.

Java notes:
- `Robot.keyPress` takes `KeyEvent.VK_*` codes and cannot type arbitrary Unicode. Use JNA `SendInput` with `KEYEVENTF_UNICODE`, or fall back to clipboard plus Ctrl+V (restore the old clipboard afterwards).

### 8.3 Media

- Keys: play/pause, next, previous, volume up/down, mute.
- Robot cannot reliably send these. Use JNA `user32.keybd_event` with `VK_MEDIA_PLAY_PAUSE`, `VK_MEDIA_NEXT_TRACK`, `VK_MEDIA_PREV_TRACK`, `VK_VOLUME_UP`, `VK_VOLUME_DOWN`, `VK_VOLUME_MUTE`.
- Later: an exact volume slider via the Windows Core Audio API.

### 8.4 Power

| Action | Windows command |
|---|---|
| Shutdown | `shutdown /s /t 0` |
| Restart | `shutdown /r /t 0` |
| Sleep | `rundll32.exe powrprof.dll,SetSuspendState 0,1,0` |
| Hibernate | `shutdown /h` |
| Lock | `rundll32.exe user32.dll,LockWorkStation` |

Safety:
- Two-step confirm on the client (tap, then hold-to-confirm).
- **Server-side confirm token:** the server issues a one-time token valid for 10 seconds for the chosen action; the execute message must carry it.
- Optional delayed shutdown with a cancel button (`shutdown /s /t 60`, cancel with `shutdown /a`).
- Actions come from a fixed `enum`; client strings never reach a shell.
- Every power action is logged with device name and time.
- `SetSuspendState` hibernates instead of sleeping when hibernation is enabled; document `powercfg -h off` as the workaround.

### 8.5 Screen View

Pipeline:

```
capture -> downscale -> JPEG encode (quality q) -> bounded queue
        -> WebSocket binary send -> client draws -> ack
```

- Starts and stops with the module; no viewer means no capture.
- **Backpressure:** at most 2 unacknowledged frames. If the client is slow, skip captures instead of queueing, so latency stays flat.
- **Adaptive quality:** if ack round-trip rises, lower JPEG quality first, then scale, then fps; recover slowly.
- Optional change detection: skip sending when a small hash of the frame is unchanged.
- Settings: quality 30-90, scale 25-100%, fps cap 1-15, monitor choice.
- The cursor is not in captures; the server sends the cursor position separately and the client draws an overlay.
- **Tap-to-control:** the client sends normalized coordinates (0..1); the server maps them to absolute pixels using the monitor origin and size.

Java notes:
- `Robot.createScreenCapture` takes tens of milliseconds at 1080p. Measure early. If too slow, switch to JNA/GDI behind `ScreenAdapter`.
- Reuse one `ImageWriter` and `ImageWriteParam` with explicit compression quality; do not create them per frame.
- On high-DPI displays Java may report scaled coordinates; handle `MultiResolutionImage` and test click mapping on a scaled display.

---

## 9. Security

### 9.1 Threat model

| Threat | Mitigation |
|---|---|
| Stranger on the same WiFi | PIN or per-device approval, lockout, warning when no PIN |
| PIN brute force | Hashed PIN, rate limit, escalating lockout, global attempt cap |
| Lost or stolen phone | Revoke from the laptop; optional token expiry |
| Token sniffing on open WiFi | HTTPS/WSS where possible (9.5); tokens are device-bound and revocable |
| Malicious page in the laptop's browser calling the admin API | Admin bound to loopback, Origin check, CSRF token, no CORS |
| Cross-site WebSocket hijacking | Validate the `Origin` header on `/ws`; auth is token-in-message, not a cookie |
| Replayed power commands | One-time confirm tokens with short expiry |

### 9.2 Pairing flow

```
Phone                         Server                       Laptop user
 |-- hello ------------------->|
 |                             | token valid? yes -> ready
 |<-- need_pin ----------------| (PIN set, token missing)
 |-- pin ---------------------->| verify hash, check lockout
 |<-- paired (token) ----------| store hash(token)
 |                             |
 |  (no PIN set instead)       |-- "Allow this phone?" ------->|
 |<-- pending_approval --------|<----------- Yes / No ---------|
 |<-- paired (token) ----------|
```

### 9.3 PIN and tokens

- First run asks: *Set a 6-digit PIN? (recommended)*. Skipping shows a clear warning and switches to approve-on-laptop mode.
- Store only a salted BCrypt or SCrypt hash. Never log or store the PIN. Compare in constant time.
- Rate limit: 5 wrong tries gives a 5-minute lockout, doubling on each repeat up to 24 hours. Track by device id **and** IP, plus a global cap.
- Device tokens: 32 random bytes from `SecureRandom`, Base64-URL encoded. The phone receives the token once; the server stores only its hash with name, created, last seen and last IP.
- Revocation deletes the record; the next connect returns `error: revoked` and the phone returns to pairing.

### 9.4 Admin surface

Served only on loopback (reject any non-loopback remote address). Features: trusted devices with revoke, change or remove PIN, show QR, toggle modules, view the action log, approve pending devices.

### 9.5 Transport and PWA caveat

Over plain `http://192.168.x.x`:
- Service workers and full PWA install need a secure context (HTTPS), except on localhost. "Add to Home Screen" still creates a shortcut, but offline caching will not work.
- Some later APIs (gyroscope for the gamepad, clipboard read, wake lock) also need a secure context.

| Option | Effort | Notes |
|---|---|---|
| Plain HTTP | None | Fine for v1; build the client so it works without a service worker |
| Self-signed certificate | Medium | HTTPS, but installing the cert on a phone is fiddly |
| Tailscale HTTPS certificates | Low | Trusted certs; also solves internet access in v2 |

### 9.6 Hardening checklist

- Bind to the chosen LAN interface, not blindly `0.0.0.0` when several adapters exist.
- Windows Firewall rule for the port on **Private** networks only.
- Message size limits; validate every field's type and range.
- Whitelist module ids and power actions; no client string reaches a shell.
- Close unauthenticated sockets after 10 seconds.
- Tray item: "Disable remote control now".

---

## 10. Data and Configuration

`config.json` under `%APPDATA%\PhoneRemote\`, written atomically (temp file, then rename), with a schema version.

```json
{
  "version": 1,
  "port": 8000,
  "pin": { "enabled": true, "hash": "..." },
  "devices": [
    {
      "id": "d_8f3a",
      "name": "Pixel 8",
      "tokenHash": "...",
      "created": "2026-10-10T21:00:00Z",
      "lastSeen": "2026-10-10T22:15:00Z",
      "lastIp": "192.168.1.23",
      "layout": ["touchpad", "keyboard", "media", "power", "screen"],
      "settings": { "sensitivity": 1.4, "screenQuality": 60, "screenScale": 50 },
      "permissions": ["*"]
    }
  ],
  "modulesEnabled": ["touchpad", "keyboard", "media", "power", "screen"]
}
```

---

## 11. Startup and Discovery

1. First-run wizard: port, PIN yes/no, auto-start yes/no.
2. Pick the active LAN IPv4 (the adapter holding the default route); let the user choose if several exist.
3. Print a QR code in the terminal and show it in the admin page, encoding `http://<ip>:<port>/` (ZXing).
4. Optional friendly name `phone-remote.local` via JmDNS. Not reliable on every Android version, so QR plus IP stays primary.
5. System tray icon: status, show QR, open admin, pause remote, quit.
6. Auto-start via a Task Scheduler entry at logon.
7. Packaging with `jpackage` (bundled runtime and `.exe` installer).

---

## 12. Java Gotchas (read before coding)

| Gotcha | Fix |
|---|---|
| Spring Boot runs headless by default, so `new Robot()` throws `HeadlessException` | `new SpringApplicationBuilder(App.class).headless(false).run(args)` or `-Djava.awt.headless=false` |
| `Robot` cannot send media keys, the Windows key, or arbitrary Unicode | JNA (`SendInput`, `keybd_event`) behind `InputAdapter` |
| Slow screen capture at high resolution | Measure; downscale early; move to JNA/GDI if needed |
| High-DPI coordinate mismatch | Handle the scaling factor and `MultiResolutionImage`; test on a scaled display |
| GC pauses from per-message allocation on mouse moves | Reuse buffers; compact messages; no per-move logging |
| Blocking the WebSocket thread with capture or encode | Dedicated capture thread plus bounded queue |
| Elevated windows and the UAC prompt ignore injected input | Document the limit; running as administrator is the user's choice |
| Input does not work on the lock screen | Out of scope for v1; document it |

---

## 13. Performance Budget

| Stage | Budget |
|---|---|
| Touch event to message sent (client batching) | up to 16 ms |
| WiFi round trip (typical home) | 2 to 15 ms |
| Server parse and inject | under 3 ms |
| **Total input latency** | **about 20 to 35 ms typical** |

Screen path at about 720p and JPEG quality 60: roughly 40-80 KB per frame, so about 3-6 Mbit/s at 10 fps.

Tactics: coalesce mouse deltas per animation frame; send nothing when idle; enable `TCP_NODELAY`; pause capture when the page is hidden (`visibilitychange`).

---

## 14. Reliability

| Case | Behavior |
|---|---|
| WiFi drops | Client shows "Reconnecting...", backs off 0.5 s to 5 s, re-sends `hello` with its token |
| Server restart | Same; client re-opens the active module on `ready` |
| Phone sleeps with a key held | Server releases all held keys and buttons on socket close |
| Two phones connected | Allowed; input from both is accepted; screen streams are independent |
| Port in use | Wizard picks the next free port and updates the QR |
| Laptop locks or sleeps | Remote stops (expected); the phone reconnects after wake |
| Server crash | Config is atomic, so nothing is corrupted; tray/auto-start relaunches |

Client status indicator: green (connected, shows ping), amber (reconnecting), red (auth error or revoked).
Logging: rotating file log with connections, auth failures and power actions. **Never log keystrokes.**

---

## 15. Testing

| Level | What | Tools |
|---|---|---|
| Unit | PIN hashing, lockout math, token verify, message validation, atomic config write | JUnit 5 |
| Module | Each module against the **fake adapters** | JUnit 5 + Mockito |
| Integration | Real WebSocket client: pair, act, revoke, lockout, Origin rejection | Spring Boot Test |
| Manual | Android Chrome, iOS Safari, high-DPI screen, two monitors | Real devices |
| Security | No token, revoked token, wrong Origin, oversized message, non-loopback admin | Integration tests |
| Latency | Timestamped ping echo and an on-screen test pattern | Manual + logs |

CI: GitHub Actions runs `mvn verify` on every push (fake adapters only). Add a build badge to the README.

---

## 16. Build Order

Finish and test each step before starting the next. Commit to git after every working step.

1. **Skeleton:** Maven project, Spring Boot with `headless(false)`, `/ws` with `hello`/`ready` and heartbeat, static hosting of `web/`, a minimal client page with reconnect and status indicator.
2. **Adapters and touchpad:** adapter interfaces, fake adapters, `RobotInputAdapter`, touchpad module end to end. Measure latency on a real phone.
3. **Keyboard and media:** add JNA for Unicode text, the Windows key and media keys.
4. **Power:** whitelist enum, confirm tokens, delayed shutdown and cancel. Test with the fake adapter only.
5. **Auth:** PIN wizard, pairing, tokens, rate limiting, admin page, revoke, Origin checks.
6. **Module host UI:** tiles, add/remove/reorder, layout persistence.
7. **Screen module:** capture thread, bounded queue, backpressure, then adaptive quality and tap-to-click.
8. **Polish:** tray icon, auto-start, QR code, firewall rule, `jpackage` build, README with architecture diagram and demo GIF.
9. **Hardening:** security tests, device matrix testing, CI badge, "design decisions" section in the README.

---

## 17. Roadmap

### v2: Internet access

| Approach | Fit |
|---|---|
| Tailscale (first choice) | No code changes; trusted HTTPS also fixes the PWA caveat |
| Relay server | The laptop connects **outbound** to a relay; the phone connects to the same relay. Needs TLS, pairing codes, end-to-end encryption so the relay cannot read or inject, and rate limits. Existing token auth maps onto relay pairing |

Design rule now: keep the protocol transport-agnostic and keep auth inside the protocol, so direct and relayed connections look the same to the modules.

### v3: Gamepad

A `GamepadAdapter` plus a gamepad module: two touch joysticks, face buttons, bumpers, triggers, D-pad, optional gyro steering (needs HTTPS). Uses the ViGEmBus driver to create a virtual Xbox 360 controller, called from Java through a ViGEm client library or JNA. Fits the existing module contract unchanged.

### Later ideas

Presentation remote, app launcher, macro buttons, file transfer, clipboard sync, multi-monitor picker, user-defined modules loaded from a folder.

---

## 18. Risks and Open Questions

| Risk | Impact | Plan |
|---|---|---|
| Java screen capture too slow | Medium | Measure in step 7; downscale early; JNA/GDI behind `ScreenAdapter` |
| Robot limits (media keys, Unicode) | Low | JNA behind `InputAdapter` (already planned) |
| iOS Safari keyboard and background-socket quirks | Medium | Test on a real iPhone early; use `input` events |
| LAN HTTP limits PWA features | Low | Degrade gracefully; Tailscale HTTPS in v2 |
| Antivirus flags a packaged exe with input injection | Medium | Distribute as a jar first; sign the exe if released |
| Lock-screen control wanted? | Decides whether a service-mode design is needed | Defer; document the limit |

---

## 19. Interview Talking Points

Keep these in mind while building; they are the parts worth explaining.

- **Why WebSocket, not REST?** Low-latency, bidirectional, one connection for input and screen frames.
- **Why adapters?** Testability (fake adapters in CI) and portability (a new OS means a new adapter, not new modules).
- **How does backpressure work?** At most 2 unacknowledged frames; drop captures instead of queueing, so latency stays flat.
- **How is concurrency handled?** One executor per session for ordered input; a dedicated capture thread with a bounded queue for screen frames.
- **How is it secured?** Hashed PIN, rate limiting with escalating lockout, hashed device tokens, Origin checks, loopback-only admin, whitelisted power actions, one-time confirm tokens.
- **What were the hard problems?** Headless Spring vs AWT Robot, media keys and Unicode via JNA, high-DPI coordinate mapping, screen capture speed.
- **What would you do differently at scale?** Move to WebRTC/H.264 for screen streaming, add a relay with end-to-end encryption for internet access.
