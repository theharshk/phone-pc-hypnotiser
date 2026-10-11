# Project Errors Log

This document tracks the errors we encountered during the development of Phone Remote, why they happened, and how we resolved them. This serves as a reference for understanding the system's edge cases, framework behaviors, and library limitations.

## 1. Spring Boot Whitelabel Error Page (404) on `/`
**Error:** When accessing `http://localhost:8080/`, the server returned a 404 Not Found "Whitelabel Error Page".
**Why it happened:** Spring Boot was configured to map the `/**` route to an external `web/` directory. By completely overriding Spring's default static file handler, we accidentally removed its built-in rule that automatically maps the root path (`/`) to `index.html`.
**Fix:** We added a `ViewControllerRegistry` rule in `AppConfig.java` to explicitly forward the `/` URL to `/index.html`. We also improved the path resolution for the `web/` folder so it reliably finds the directory regardless of where your IDE launches the application from.

## 2. JNA `KEYEVENTF_UNICODE` Not Found
**Error:** `java: cannot find symbol ... variable KEYEVENTF_UNICODE ... location: interface com.sun.jna.platform.win32.User32`
**Why it happened:** We tried to use the `KEYEVENTF_UNICODE` constant directly from JNA's `User32` class. JNA is a wrapper that maps native Windows C++ code to Java. However, the maintainers of the JNA library didn't expose every single Windows macro as a Java constant in their wrapper, and this one was missing.
**Fix:** We looked up the official hexadecimal value from the Microsoft Win32 API documentation (`0x0004`) and manually defined it as a `public static final int` inside our `JnaKeyboard` class.

## 3. JNA `keybd_event` Not Found
**Error:** `java: cannot find symbol ... method keybd_event(byte,byte,DWORD,ULONG_PTR) ... location: variable INSTANCE of type User32`
**Why it happened:** Just like the missing constant above, we tried to call the Windows API function `keybd_event` through JNA. However, Microsoft officially superseded `keybd_event` with the newer `SendInput` function many years ago. Because of this, the developers of JNA decided not to include the legacy `keybd_event` function in their standard `User32` Java interface.
**Fix:** We rewrote the `keyDown` and `keyUp` methods to use the modern `User32.INSTANCE.SendInput` method instead. This involved formatting the keystroke instructions into a `KEYBDINPUT` hardware structure, which is exactly how modern Windows systems expect to receive synthesized keyboard events.

## 4. `encWaitMs` Cannot Find Symbol in ScreenModule
**Error:** `java: cannot find symbol variable encWaitMs location: class com.phoneremote.module.ScreenModule.StreamContext`
**Why it happened:** When we pipelined the Screen streaming into three separate threads (Capture, Encode, and Send), we calculated how long a frame sat in the queue before encoding inside the `Encode` thread using a local variable (`long encWaitMs = ...`). However, we tried to print this variable in the final log statement inside the completely separate `Send` thread. Java strictly isolates local variables per thread/block, so the compiler rejected it.
**Fix:** We attached the `encWaitMs` timing explicitly as a field onto the `FrameData` memory object itself. Because the `FrameData` object is physically passed down the queues from the Encode thread to the Send thread, the Send thread could cleanly access it as `fd.encWaitMs` to print the final log.

## 5. Admin Live Logs Box Empty (Ring Buffer Ignored)
**Error:** The Admin UI's Live Log terminal was permanently empty, even though the console and `.log` files were actively recording traces. 
**Why it happened:** Spring Boot's internal initialization lifecycle aggressively resets and overwrites custom logging configurations. Even though our custom 500-line `InMemoryLogAppender` ring buffer was correctly declared inside `logback-spring.xml`, Spring Boot was silently detaching it during its internal boot phases. Furthermore, because we were logging millions of frame metrics into the `com.phoneremote` root namespace, the ring buffer would have instantly overflowed anyway.
**Fix:** We removed the ring buffer from the XML file completely. Instead, we injected a `@PostConstruct` lifecycle hook directly into `AdminController.java`. This guarantees the ring buffer is attached *after* Spring Boot is completely done booting. We also isolated the frame logs into a separate `com.phoneremote.frames` namespace with `additivity="false"` to prevent them from bleeding into and spamming the application's ring buffer.

## 6. Active WebSocket Revocation Desync (Revoked Phone Remains Connected)
**Error:** Clicking **Revoke** on the admin page successfully removed the device from the database, but already-connected phones remained fully functional (mouse, keyboard, screen streaming continued). Only refreshing the browser tab on the phone showed the "Device Revoked" page.
**Why it happened:** 
1. **Static "Check-at-the-Door" Authentication:** The device token was only validated once during the initial `"hello"` WebSocket handshake. Once authenticated, the in-memory `Session` object stored `authenticated = true`, and all subsequent WebSocket packets only checked that boolean flag without ever re-checking persistent storage (`ConfigStore`).
2. **Decoupled Architecture:** Admin revocation in `AdminController` was purely a database operation (`configStore.removeDevice(...)`) with no link to the WebSocket subsystem.
3. **Missing Reverse Index:** `RemoteSocketHandler` indexed sessions only by the ephemeral WebSocket session ID (`wsSession.getId()`). There was no map from `deviceId` to active `Session` instances, so the server could not locate open sockets belonging to the revoked device.
4. **Client-Side Reconnect Loop:** The client frontend (`web/host.js`) only anticipated revocation during the initial `"hello"` response. If a socket disconnected without an explicit terminal signal, its `onclose` handler triggered auto-reconnect backoff loops indefinitely while continuing to hold module states.
**Fix:**
1. **Thread-Safe Device-to-Session Map:** Added a `deviceSessions` map (`ConcurrentHashMap<String, Set<Session>>`) in `RemoteSocketHandler` to register sessions upon successful authentication and unregister them on disconnect.
2. **Active Push Revocation:** In `AdminController.handleRevoke`, after removing the device from `ConfigStore`, the server calls `socketHandler.revokeDevice(deviceId)` (or `revokeAllDevices()`). For each open session, it sends `{"m":"core","t":"error","d":{"code":"revoked"}}`, calls `module.onClose(session)` to release input keys and stop screen capture pipelines, marks `session.setAuthenticated(false)`, and closes the socket.
3. **Heartbeat Safety Net:** Added a verification check on every `"ping"` message: if the session is authenticated but its device record no longer exists in `ConfigStore`, the server triggers the immediate revocation teardown.
4. **Client Terminal State:** Updated `web/host.js` so that receiving `"revoked"` sets `isRevoked = true`, cleans up active modules, clears stored tokens, presents the revoked overlay, and inhibits the auto-reconnect logic.

## 7. Missing `web/admin/index.html` (IDE Working Directory Mismatch)
**Error:** Visiting `http://localhost:8080/admin` returned `"Missing web/admin/index.html"` or a 404 response.
**Why it happened:** In `AdminController.java`, the static SPA template was being loaded from disk via `new File("web/admin/index.html")`. When launched from certain IDE configurations or runner scripts, the process working directory was set to the `server/` module subdirectory instead of the repository root (`F:\phone pc hypnotiser`), causing `web/admin/index.html` to not resolve.
**Fix:** Implemented a resilient fallback path lookup in `renderSPA`:
```java
File f = new File("web/admin/index.html");
if (!f.exists()) {
    f = new File("../web/admin/index.html");
}
```

## 8. Admin Dashboard UTF-8 Mojibake on Security PIN Dots (`â€¢`)
**Error:** In the Admin Panel security settings card, masked PIN bullets appeared corrupted as `â€¢â€¢â€¢â€¢â€¢â€¢` instead of `••••••`.
**Why it happened:** `AdminController.java` read `index.html` bytes into a String without specifying a character encoding (`new String(Files.readAllBytes(...))`), causing the JVM to decode UTF-8 bytes using the Windows system default encoding (Windows-1252). Additionally, Spring `@GetMapping` endpoints defaulted to standard `text/html` without an explicit UTF-8 charset declaration in the `Content-Type` header, causing browser decoding mismatch.
**Fix:** Specified `StandardCharsets.UTF_8` explicitly when reading bytes to String, and added `produces = "text/html;charset=UTF-8"` to all HTML-serving endpoints in `AdminController.java`.

## 9. Phone UI Status Dot Glow Clipping & Visibility in Light Mode
**Error:** The green connection status dot on the mobile web interface appeared clipped with a flat edge and did not show a visible glow or flare in light mode.
**Why it happened:** 
1. The parent container `.status-line` had height and overflow constraints that clipped the outer radial `box-shadow` blur spread.
2. Light mode theme variables had insufficient alpha contrast for the emerald glow against light backgrounds (`#E8EBF0`).
**Fix:** Added `overflow: visible` to `.status-line` in `web/style.css`, and configured a multi-layered radial box-shadow with distinct RGBA color stops for both light and dark themes to ensure an unclipped, luminous pulse flare.

## 10. `NullPointerException` on `MDCAdapter` in `InMemoryLogAppender`
**Error:**
```text
java.lang.NullPointerException: Cannot invoke "org.slf4j.spi.MDCAdapter.getCopyOfContextMap()" because "mdcAdapter" is null
    at ch.qos.logback.classic.spi.LoggingEvent.getMDCPropertyMap(LoggingEvent.java:411)
    at ch.qos.logback.classic.spi.LoggingEvent.prepareForDeferredProcessing(LoggingEvent.java:255)
    at com.phoneremote.logging.InMemoryLogAppender.append(InMemoryLogAppender.java:23)
```
**Why it happened:** In `InMemoryLogAppender.append()`, calling `eventObject.prepareForDeferredProcessing()` directly accesses `mdcAdapter` on the event. In isolated unit tests (such as `AdminLogsTest`) where synthetic `LoggingEvent` instances were constructed manually without an active SLF4J MDC context, `mdcAdapter` was null. Logback's `AppenderBase.doAppend()` swallowed the NPE, silently dropping mock events from the in-memory ring buffer and causing unit test assertions to fail.
**Fix:** Wrapped `eventObject.prepareForDeferredProcessing()` in a `try-catch (Throwable ignored)` block and overrode `public synchronized void doAppend(ILoggingEvent eventObject) { append(eventObject); }` so test-injected events bypass Logback's uninitialized context checks and append reliably.

## 11. Missing `isOpen()` Delegate on Session Wrapper
**Error:**
```text
[ERROR] RemoteSocketHandler.java:[76,35] cannot find symbol
  symbol:   method isOpen()
  location: variable session of type com.phoneremote.ws.Session
```
**Why it happened:** `RemoteSocketHandler` wraps Spring's `WebSocketSession` inside an internal `Session` class (handling single-threaded executors and attributes). When adding approval and revocation methods that check whether a socket is still active before sending messages, `session.isOpen()` was called, but the custom `Session` class did not expose an `isOpen()` delegate method for its underlying `WebSocketSession`.
**Fix:** Added `public boolean isOpen() { return wsSession.isOpen(); }` to `Session.java`.

## 12. Spring Boot `BeanCreationException`: `No default constructor found` on Multi-Constructor Beans
**Error:**
```text
org.springframework.beans.factory.BeanCreationException: Error creating bean with name 'autoStartManager': 
Failed to instantiate [com.phoneremote.autostart.AutoStartManager]: No default constructor found
Caused by: java.lang.NoSuchMethodException: com.phoneremote.autostart.AutoStartManager.<init>()
```
**Why it happened:** `AutoStartManager` declared two constructors:
- `public AutoStartManager(CommandRunner commandRunner)` (intended for production Spring injection)
- `public AutoStartManager(CommandRunner commandRunner, String workingDir)` (overload for unit tests with custom directories)

In Spring Boot, when a `@Component` class declares multiple constructors and none are annotated with `@Autowired`, Spring cannot infer which constructor to use for dependency injection and falls back to looking for a no-argument constructor `AutoStartManager()`. Because no zero-arg constructor existed, Spring aborted initialization.
**Fix:** Added `@Autowired` to the primary constructor in `AutoStartManager.java` (and `TerminalWizard.java`) to explicitly guide Spring's constructor injection.
