# DESIGN.md: Phone-to-PC Remote Control (Java)

A self-hosted alternative to Unified Remote. A **Java (Spring Boot)** server runs on a Windows laptop. The phone uses a browser web app (PWA) over WiFi. Internet access comes later.

> **Instructions for AI agents:** Read this file before every task. Build **one step at a time** (section 16). Stop after each step and say how to test it. Do not implement features outside the current step. Keep OS-specific code inside `adapter/` only. Never pass client-supplied strings to a shell.

### Working rules (apply to every task)

- Only edit the files the task names. If another file must change, stop and ask.
- Edit with the normal editing tool using small targeted changes. No helper scripts (`.py`, `.ps1`) in the repo, and no rewriting whole files (new files are fine).
- Never run shutdown, restart, sleep, hibernate, `netsh` or `schtasks`. Never use `git reset`, force push or branch deletes.
- Test power features with the fake adapter only.
- Never log PINs, tokens, typed text, raw incoming messages or screen contents.
- Do not weaken, delete or skip existing tests. If a test must change to compile, make the minimum change and list it.
- When finished, list the files changed and show real test output. Do not say it works without running it.
- Where this file and a task prompt disagree about visuals, the task prompt wins.

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
| Input | `java.awt.Robot` plus **JNA** (`SendInput`) for what Robot cannot do |
| Screen capture | `Robot.createScreenCapture`, `ImageIO` for JPEG |
| JSON | Jackson |
| Password hashing | Spring Security Crypto (BCrypt or SCrypt); no full Spring Security needed |
| QR code | ZXing |
| mDNS (optional) | JmDNS |
| Tray icon | `java.awt.SystemTray` |
| Packaging | `jpackage` (bundled runtime, Windows installer) |
| Tests | JUnit 5, Mockito, Spring Boot Test |
| CI | GitHub Actions |
| Frontend | Plain HTML/CSS/JS, no build step, mobile-first. Dark by default; Light and System themes are part of the phone UI step (see section 21) |

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
- **Sessions are live, not just checked at the door.** Authentication state can be revoked while a socket is open (section 9.3).

### 4.1 Package layout

```
phone-remote/
  docs/DESIGN.md
  web/                                 phone client (served by Spring)
    index.html  app.js  host.js  style.css  manifest.json
    fonts/                             bundled woff2 files (no CDNs)
    modules/  touchpad.js keyboard.js media.js power.js screen.js
  server/
    pom.xml
    src/main/java/com/phoneremote/
      App.java                         entry point (headless=false)
      config/    ConfigStore, AppConfig, DeviceRecord
      auth/      AuthService, PinService, TokenService, LockoutTracker
      ws/        RemoteSocketHandler, Session, Envelope, MessageValidator
      module/    RemoteModule, ModuleRegistry
      module/impl/ TouchpadModule, KeyboardModule, MediaModule,
                   PowerModule, ScreenModule
      adapter/   InputAdapter, ScreenAdapter, PowerAdapter
      adapter/windows/ RobotInputAdapter, JnaKeyboard, RobotScreenAdapter,
                       WindowsPowerAdapter
                       (GdiScreenAdapter: not built, optional)
      adapter/fake/    FakeInputAdapter, FakeScreenAdapter, FakePowerAdapter
      admin/     AdminController (loopback only)
      net/       NetworkInfo, QrService, MdnsService
      tray/      TrayService
    src/test/java/com/phoneremote/...
  README.md
```

File names are a guide. Check the actual tree before assuming a class exists.

### 4.2 Threading model

- Spring's WebSocket layer handles I/O.
- **Input injection** is quick; run it on a single-threaded executor per session so ordering is preserved.
- **Screen capture, JPEG encoding and sending** run on separate threads joined by bounded queues (section 8.5).
- **Power commands** run through `ProcessBuilder` after the acknowledgement has been sent.
- A device-to-sessions index (thread-safe) lets the admin revoke act on live sockets.

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
| S to C | `error` | Code plus message: `bad_pin`, `locked_out` (includes `retryAfterSeconds`), `revoked` (can arrive on an already open connection), `upgrade_required` |
| both | `ping` / `pong` | Heartbeat every 10 s; also gives latency; the server re-checks the device on each ping |
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
    default void onClose(Session s) {}   // release held keys/buttons, stop captures; must be safe to call twice
}
```

Each module is a Spring `@Component`. `ModuleRegistry` collects `List<RemoteModule>` and routes messages by `id()`. Adding a module means adding one class (and one JS file).

### 6.2 Client contract

```js
export default {
  id: 'touchpad', name: 'Touchpad', icon: 'icon-touchpad',  // inline SVG icon id, no emoji
  mount(el, api) {},   // api.send(type, data), api.on(type, fn)
  unmount() {},
};
```

### 6.3 Lifecycle

1. The phone opens a tile and sends `core/open` with the module id.
2. The server calls `onOpen`; heavy modules (screen) start work now.
3. Messages flow under the module's namespace.
4. On close, hidden tab, disconnect or revoke, the server calls `onClose` and **releases every held key and mouse button**.

### 6.4 Layout persistence

Tile set and order are saved per device in the server config and cached in `localStorage` on the phone for an instant first render.

### 6.5 Phone navigation

The URL hash is the single source of truth for the visible screen (`#touchpad`, and so on). One `render(route)` function reads the hash and is called from `hashchange` and at startup, so the Android back button works. The in-app Back button calls `history.back()`. Leaving a module calls its `unmount()` and sends `core/close`. The pairing screen shows whenever the connection is not authenticated.

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
| Input | `java.awt.Robot` for mouse and basic keys; JNA `SendInput` for media keys, Win key and Unicode (`keybd_event` is not in `jna-platform`'s `User32`) |
| Screen | `Robot.createScreenCapture`. A JNA GDI `BitBlt` adapter is **not built**; it is the planned escape route if capture speed matters |
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
- Planned (phone UI step): shortcut row (copy, paste, undo, select all, Alt+Tab, Win+D, Ctrl+W) and saved snippets, sent through the existing key and text messages.

Java notes:
- `Robot.keyPress` takes `KeyEvent.VK_*` codes and cannot type arbitrary Unicode. Use JNA `SendInput` with `KEYEVENTF_UNICODE`. Send inputs in one contiguous `INPUT[]` array.

### 8.3 Media

- Keys: play/pause, next, previous, volume up/down, mute.
- Robot cannot reliably send these. Use JNA `SendInput` with `VK_MEDIA_PLAY_PAUSE`, `VK_MEDIA_NEXT_TRACK`, `VK_MEDIA_PREV_TRACK`, `VK_VOLUME_UP`, `VK_VOLUME_DOWN`, `VK_VOLUME_MUTE`.
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
- Two-step confirm on the client. Currently hold-to-confirm; slide-to-confirm (with an accessible button alternative) is planned in the phone UI step.
- **Server-side confirm token:** the server issues a one-time token valid for 10 seconds for the chosen action; the execute message must carry it. Pending tokens are invalidated when the session ends.
- Optional delayed shutdown with a cancel button (`shutdown /s /t 60`, cancel with `shutdown /a`).
- Actions come from a fixed `enum`; client strings never reach a shell.
- Every power action is logged with device name and time.
- `SetSuspendState` hibernates instead of sleeping when hibernation is enabled; document `powercfg -h off` as the workaround.

### 8.5 Screen View

Pipeline:

```
Capture thread (Robot capture -> target dims)
  -> encodeQueue (capacity 2)
  -> Encode thread (scale RGB -> ImageWriter JPEG)
  -> sendQueue (capacity 2)
  -> Sender thread (binary frame over WebSocket) -> client draws -> ack
```

- Starts and stops with the module; no viewer means no capture.
- **Pipelined stages:** decoupled threads joined by bounded `ArrayBlockingQueue`s (capacity 2). If a queue is full, the oldest frame is dropped and logged, so latency stays flat.
- **Backpressure:** at most 2 unacknowledged frames. If the client is slow, skip captures instead of queueing.
- **Frame log:** a separate logger (`com.phoneremote.frames`, file `logs/frames.log`) records per-frame timing: capture, encode wait, scale, encode, send wait, size and drops. It is kept out of the App log.
- **Measured (this laptop, Robot capture):** capture about 70 to 110 ms, encode about 40 to 98 ms, frames 50 to 105 KB, about 10 fps. Before pipelining it was about 5 fps. Capture is the bottleneck.
- Settings (as reported by the implementation; verify in code): quality 30-90 (default 80), scale 25-100% (default 100), fps default 10, fps cap range 1-30, monitor choice.
- Adaptive quality (lower quality, then scale, then fps when ack round trip rises) and change detection are **planned, not confirmed built**. Check `ScreenModule` before claiming them.
- The cursor is not in captures; the server sends the cursor position separately and the client draws an overlay.
- **Tap-to-control:** the client sends normalized coordinates (0..1); the server maps them to absolute pixels using the monitor origin and size.

Java notes:
- `Robot.createScreenCapture` is the bottleneck. Options if more speed is needed: GDI `BitBlt` via JNA behind `ScreenAdapter`, or an optional FFmpeg H.264 video mode with JPEG as the fallback.
- Reuse one `ImageWriter` and `ImageWriteParam` per encode thread; do not create them per frame.
- On high-DPI displays Java may report scaled coordinates; handle `MultiResolutionImage` and test click mapping on a scaled display.

---

## 9. Security

### 9.1 Threat model

| Threat | Mitigation |
|---|---|
| Stranger on the same WiFi | PIN or per-device approval, lockout, warning when no PIN |
| PIN brute force | Hashed PIN, rate limit, escalating lockout, global attempt cap |
| Lost or stolen phone | Revoke from the laptop; takes effect on open sessions immediately |
| Token sniffing on open WiFi | HTTPS/WSS where possible (9.5); tokens are device-bound and revocable |
| Malicious page in the laptop's browser calling the admin API | Admin bound to loopback, Host header check (DNS rebinding), Origin check, CSRF token, no CORS |
| Cross-site WebSocket hijacking | Validate the `Origin` header on `/ws`; auth is token-in-message, not a cookie |
| Stored XSS through device names or log lines | HTML-escape every dynamic value on the admin page |
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

### 9.3 PIN, tokens, lockout and revocation

- First run asks: *Set a 6-digit PIN? (recommended)*. Skipping shows a clear warning and switches to approve-on-laptop mode.
- Store only a salted BCrypt or SCrypt hash of the PIN. Never log or store the PIN. Compare in constant time.
- **Lockout:** 5 wrong tries gives a 5-minute lockout, doubling on each repeat up to 24 hours. Tracked by device id **and** IP, plus a global cap. `locked_out` replies include `retryAfterSeconds`. A PIN sent during a lockout is not counted as a failure and does not extend it. The phone shows a locked screen with a countdown (monotonic clock, from the server's remaining time), disables PIN entry, and returns to PIN entry when it ends. A reconnect during a lockout gets `locked_out` with the remaining time.
- **Device tokens:** 32 random bytes from `SecureRandom`, Base64-URL encoded. The phone receives the token once; the server stores only its hash with name, created, last seen and last IP.
- **Revocation (live):** deleting a device record pushes `{"m":"core","t":"error","d":{"code":"revoked"}}` to every open session of that device (via the device-to-sessions index). The server stops each module (`onClose`: releases held keys and buttons, stops screen capture), marks the session unauthenticated, then closes the socket. As a safety net, every `ping` checks the device still exists. On `revoked`, the phone clears its saved token, shows the "device revoked" overlay on its current screen, stops sending, and does not auto-reconnect. A "Pair again" button leads back to pairing.
- **Why this exists:** the original design checked the token only in `hello`, so revoking took effect only on the next connection. Authentication is now a live session state.

### 9.4 Admin surface

Served only on loopback (reject any non-loopback remote address), with a Host header check, CSRF token on every POST, and escaping of every dynamic value. Features: paired devices with revoke, change or remove PIN, QR code and phone address, pending approvals, and a Logs and Stats area (App log, Frame log with rolling averages and a bottleneck hint, CSV download). Redesigned as a desktop dashboard (section 21).

### 9.5 Transport and PWA caveat

Over plain `http://192.168.x.x`:
- Service workers and full PWA install need a secure context (HTTPS), except on localhost. "Add to Home Screen" still creates a shortcut, but offline caching will not work. The app must work without a service worker.
- Some later APIs (gyroscope for the gamepad, clipboard read, wake lock) also need a secure context; use them only when available.

| Option | Effort | Notes |
|---|---|---|
| Plain HTTP | None | Fine for v1 |
| Self-signed certificate | Medium | HTTPS, but installing the cert on a phone is fiddly |
| Tailscale HTTPS certificates | Low | Trusted certs; also solves internet access in v2 |

### 9.6 Hardening checklist

- Bind to the chosen LAN interface, not blindly `0.0.0.0` when several adapters exist.
- Windows Firewall rule for the port on **Private** networks only.
- Message size limits; validate every field's type and range.
- Whitelist module ids and power actions; no client string reaches a shell.
- Close unauthenticated sockets after 10 seconds.
- Tray item: "Disable remote control now".
- The `logs/` folder is git-ignored and never committed.

---

## 10. Data and Configuration

`config.json` under `%APPDATA%\PhoneRemote\`, written atomically (temp file, then rename), with a schema version. Default server port is 8080. Runtime logs go to a `logs/` folder (`phoneremote.log`, `frames.log`) that is git-ignored.

```json
{
  "version": 1,
  "port": 8080,
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

`permissions` is reserved for per-device authorization (not built; every paired device currently has full access).

---

## 11. Startup and Discovery

1. First-run wizard: port, PIN yes/no, auto-start yes/no. Use one shared stdin reader (`Scanner(System.in)`), not `System.console()`.
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
| `Robot` cannot send media keys, the Windows key, or arbitrary Unicode | JNA `SendInput` behind `InputAdapter` |
| `User32.keybd_event` does not exist in `jna-platform` | Use `SendInput` for every key, in one contiguous `INPUT[]` |
| Slow screen capture at high resolution | Measure; downscale early; pipeline the stages; GDI or FFmpeg if needed |
| High-DPI coordinate mismatch | Handle the scaling factor and `MultiResolutionImage`; test on a scaled display |
| GC pauses from per-message allocation on mouse moves | Reuse buffers; compact messages; no per-move logging |
| Blocking the WebSocket thread with capture or encode | Dedicated threads plus bounded queues |
| `WebSocketSession` is not safe for concurrent sends | Stop the module first, then send; or use `ConcurrentWebSocketSessionDecorator` |
| Teardown running twice (revoke and `afterConnectionClosed`) | Make `onClose` idempotent |
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

Tactics: coalesce mouse deltas per animation frame; send nothing when idle; enable `TCP_NODELAY`; pause capture when the page is hidden (`visibilitychange`). No blur, glass or animation on the touchpad or the screen canvas.

---

## 14. Reliability

| Case | Behavior |
|---|---|
| WiFi drops | Client shows "Reconnecting...", backs off 0.5 s to 5 s, re-sends `hello` with its token |
| Server restart | Same; client re-opens the active module on `ready` |
| Device revoked | Phone shows the revoked overlay, stops sending, does not reconnect |
| Phone sleeps with a key held | Server releases all held keys and buttons on socket close |
| Two phones connected | Allowed; input from both is accepted; screen streams are independent |
| Port in use | Wizard picks the next free port and updates the QR |
| Laptop locks or sleeps | Remote stops (expected); the phone reconnects after wake |
| Server crash | Config is atomic, so nothing is corrupted; tray/auto-start relaunches |

**Status indicator** (color is always paired with a word or icon):

| State | Color | Text |
|---|---|---|
| Connected | success (green) | "Connected, 12 ms" |
| Reconnecting | warning (amber), pulsing dot | "Reconnecting..." |
| Disconnected, auth error or revoked | danger (red) | what happened and what to do |

Logging: rotating file log with connections, auth failures and power actions. **Never log keystrokes.**

---

## 15. Testing

| Level | What | Tools |
|---|---|---|
| Unit | PIN hashing, lockout math (fake clock), token verify, message validation, atomic config write | JUnit 5 |
| Module | Each module against the **fake adapters** | JUnit 5 + Mockito |
| Integration | Real WebSocket client: pair, act, revoke, lockout, Origin rejection | Spring Boot Test |
| Phone logic | Countdown, slide-to-confirm and settings logic extracted from the DOM | `node --test` |
| Manual | Android Chrome, high-DPI screen, two monitors | Real devices |
| Security | No token, revoked token, wrong Origin, oversized message, non-loopback admin, wrong Host header | Integration tests |
| Latency | Timestamped ping echo, frame log numbers | Manual + logs |

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

### 16.1 Progress

| Step | State |
|---|---|
| 1 Skeleton | Done |
| 2 Adapters and touchpad | Done |
| 3 Keyboard and media | Done |
| 4 Power | Done (hold-to-confirm) |
| 5 Auth | Done, including live revoke and lockout screen |
| 6 Module host UI | In progress, together with the phone visual redesign (section 21) |
| 7 Screen module | Done (JPEG, pipelined, about 10 fps; adaptive quality not confirmed) |
| Admin panel and logs | Redesigned; App log and Frame log pages |
| 8 Polish | Not started |
| 9 Hardening | Not started |

---

## 17. Roadmap

### v2: Internet access

| Approach | Fit |
|---|---|
| Tailscale (first choice) | No code changes; trusted HTTPS also fixes the PWA caveat |
| Relay server | The laptop connects **outbound** to a relay; the phone connects to the same relay. Needs TLS, pairing codes, end-to-end encryption so the relay cannot read or inject, and rate limits. Existing token auth maps onto relay pairing |

Design rule now: keep the protocol transport-agnostic and keep auth inside the protocol, so direct and relayed connections look the same to the modules.

### Screen quality upgrades (optional)

1. GDI `BitBlt` capture behind `ScreenAdapter` (faster than Robot).
2. FFmpeg H.264 video mode with JPEG as the automatic fallback.

### v3: Gamepad

A `GamepadAdapter` plus a gamepad module: two touch joysticks, face buttons, bumpers, triggers, D-pad, optional gyro steering (needs HTTPS). Uses the ViGEmBus driver to create a virtual Xbox 360 controller. Fits the existing module contract unchanged.

### Later ideas

Presentation remote, app launcher, macro buttons, file transfer, clipboard sync, multi-monitor picker, per-device permissions, user-defined modules loaded from a folder.

---

## 18. Risks and Open Questions

| Risk | Impact | Plan |
|---|---|---|
| Java screen capture too slow | Medium | Measured: capture is the limit at about 10 fps; GDI or FFmpeg if needed |
| Robot limits (media keys, Unicode) | Low | JNA `SendInput` behind `InputAdapter` (done) |
| AI-agent edits breaking unrelated features | Medium | Working rules above, small tasks, branches, commit before each session, read `git diff --stat` |
| Stale design doc misleading agents | Low | Update this file after each step, doc-only edits |
| iOS Safari quirks | Low | Not a target (Android only) |
| LAN HTTP limits PWA features | Low | Degrade gracefully; Tailscale HTTPS in v2 |
| Antivirus flags a packaged exe with input injection | Medium | Distribute as a jar first; sign the exe if released |
| Lock-screen control wanted? | Decides whether a service-mode design is needed | Defer; document the limit |

---

## 19. Interview Talking Points

- **Why WebSocket, not REST?** Low-latency, bidirectional, one connection for input and screen frames.
- **Why adapters?** Testability (fake adapters in CI) and portability (a new OS means a new adapter, not new modules).
- **How does backpressure work?** At most 2 unacknowledged frames; drop captures instead of queueing, so latency stays flat.
- **How is concurrency handled?** One executor per session for ordered input; capture, encode and send threads joined by bounded queues; a thread-safe device-to-sessions index for revoke.
- **How is it secured?** Hashed PIN, rate limiting with escalating lockout, hashed device tokens, Origin and Host checks, loopback-only admin with CSRF and escaping, whitelisted power actions, one-time confirm tokens.
- **What was a real bug you found?** Authentication was checked once at handshake, so revoking a device did not affect its open connection. Fixed with a device-to-sessions index, a pushed `revoked` message, module teardown and a heartbeat re-check.
- **How did you improve performance?** Measured each stage with a frame log (capture 60 ms, encode 34 ms), pipelined capture and encode, went from about 5 to 10 fps, and identified Robot capture as the remaining limit.
- **What were the hard problems?** Headless Spring vs AWT Robot, `SendInput` for media keys and Unicode, high-DPI coordinate mapping, screen capture speed.
- **What would you do differently at scale?** Move to WebRTC/H.264 for screen streaming, add a relay with end-to-end encryption for internet access.

---

## 20. Changes since v1 of this doc

- Client module contract uses an inline SVG icon id, not an emoji.
- `locked_out` includes `retryAfterSeconds`; `revoked` can arrive on an open connection.
- Revocation is live: device-to-sessions index, module teardown, heartbeat re-check, no auto-reconnect on the phone.
- Lockout: PINs sent during a lockout are not counted; locked screen with a countdown; reconnects get the remaining time.
- Screen pipeline is staged with bounded queues; frame log added; measured numbers recorded.
- Default port is 8080; logs live in a git-ignored `logs/` folder.
- Status indicators use success (green), warning (amber) and danger (red), each paired with a word or icon. Cobalt remains the interactive accent.
- Admin panel redesigned with Logs and Stats; phone UI redesign in progress (section 21).
- `GdiScreenAdapter` is not built (optional).
- Added working rules for agents and a progress table.

---

## 21. UI Design System

One visual language for the admin panel (laptop) and the phone controller.

### 21.1 Principles

- **Flat, cool and bold:** cool greys, one cobalt accent, one high-contrast card per screen (black in light mode, cobalt in dark mode). No decorative warm or green tints on backgrounds, tiles or hero cards.
- **Status colors are allowed and expected,** for state only: success (green), warning (amber), danger (red). Never use color alone; pair it with a word or icon.
- **Performance first:** no blur, glass or animation on the touchpad, scroll strip, screen canvas or key bar.
- **Large touch targets** (at least 48 px), real `<button>` elements, visible focus, inline SVG icons, no emoji, contrast of at least 4.5:1 (3:1 for large text).

### 21.2 Palette

| Token | Dark | Light |
|---|---|---|
| ground | `#05070B` | `#E8EBF0` |
| card | `#11141C` | `#FFFFFF` |
| card-alt | `#1A1F2B` | `#DCE1EA` |
| border | `#263047` | `#C7CEDA` |
| text | `#F2F5FA` | `#0A0D14` |
| muted | `#98A3B8` | `#5B6577` |
| accent (cobalt) | `#2F5BFF` | `#2F5BFF` |
| accent-text | `#7C98FF` | `#1F45D6` |
| success | `#3DDC97` | `#0B7A4B` |
| warning | `#FFB020` (dark text on fill) | `#FFB020` fill, `#8A5300` text |
| danger | `#FF5C66` | `#D92D38` |

Verify contrast for every pair before shipping and adjust values that fall below 4.5:1.

### 21.3 Type and shape

- Archivo 800 for headings, Instrument Sans for body, JetBrains Mono for numbers, addresses and ping. Fonts are bundled locally (woff2); no CDNs.
- Radii by hierarchy: hero tile 28 px, tiles 22 px, rows 18 px, buttons pills or 16 px, small pills 999 px.
- Primary action: a pill, black (light) or white (dark). Secondary: outlined pill. The strongest action per screen may be cobalt.

### 21.4 Admin panel

Desktop layout: full-height black sidebar with labeled icons, breadcrumb top bar, bento grid of cards in different sizes. Pages: Overview (how to connect with QR and address, connection security, paired devices, stats), Devices, Logs and Stats, Settings. All dynamic values escaped; same protections as section 9.4.

### 21.5 Phone controller (in progress)

- Dark by default; Light and System selectable in Settings, saved in `localStorage` (inside try/catch) and applied before first paint.
- Home: status line, quick actions row (mute, lock, sleep), cobalt hero tile for the first module, grid of tiles, "Add a remote", Edit and Settings.
- **Glass is allowed only on overlays** (power confirm sheet, revoked overlay, locked overlay, bottom sheets), wrapped in `@supports` with a solid fallback.
- Planned features: slide-to-confirm for power (with a button alternative), bedside mode (dimmed UI), keyboard shortcut row and snippets, haptics switch.
- Pairing screen: PIN entered only with the in-page keypad. The Android system keyboard must never appear (readonly, `inputmode="none"`, no `.focus()` on inputs).
- Bottom dock only on Home and Settings; hidden on the touchpad, screen view and keyboard.
