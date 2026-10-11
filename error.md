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
