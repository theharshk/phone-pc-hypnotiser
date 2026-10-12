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

## 13. Screen Touch Control Inoperative & Mouse Cursor Auto-Hiding
**Error:** Tapping or touching the live screen view on mobile did not send clicks/taps to the host PC, and the cursor dot disappeared after 2.5 seconds of inactivity.
**Why it happened:** 
1. In `web/modules/screen.js`, an orphaned guard clause `if (isRelativeMode) return;` was left in the pointer tap handler. When the screen module was active, taps were aborted instead of sending `{m: 'screen', t: 'tap'}` messages to the server.
2. A 2.5s hide timeout (`setTimeout(() => cursor.style.opacity = '0', 2500)`) automatically hid the cursor pointer dot on the live stream.
**Fix:** Removed the orphaned `isRelativeMode` check so screen touches/taps directly dispatch `{m: 'screen', t: 'tap', d: {x, y, button}}` to the server. Removed the 2.5s opacity timeout and styled the cursor dot to remain permanently visible and smoothly track Windows mouse positions in real time.

## 14. Admin PIN Input Box Character Overflow (Horizontal Scroll Clipping)
**Error:** In the Admin UI Settings and Overview security cards, typing the 6-digit PIN or viewing masked bullets (`••••••`) caused the digits to overflow the container, triggering awkward horizontal scrolling and clipping behind the eye toggle button.
**Why it happened:** The input element used `font-size: 3rem` (48px) with `letter-spacing: 0.4em` (~19px) and `padding: 20px 50px` inside a container constrained to `max-width: 340px`. Six monospace characters with wide spacing required ~388px+ of width, overflowing the 340px box.
**Fix:** Adjusted container width to `max-width: 380px`, reduced `font-size` to `2.2rem` with `letter-spacing: 0.25em` and `padding: 16px 50px`. This fits all 6 digits and bullets centered comfortably with ample margin before the visibility toggle button without horizontal overflow.

## 15. Windows Task Scheduler Auto-Start `/TR` Command Line Quote Nesting
**Error:** When registering the `PhoneRemote` auto-start task with Windows Task Scheduler (`schtasks.exe`), task creation failed or broke when paths contained spaces (such as `F:\phone pc hypnotiser`).
**Why it happened:** `AutoStartManager.java` constructed the task command using `cmd.exe /c cd /d "<workingDir>" && "<javawPath>" -jar server.jar`. Task Scheduler's `/TR` parameter has fragile quote escaping rules. Nesting double quotes inside `/TR` (e.g. quotes for `cd /d`, quotes for `javawPath`, and quotes for paths with spaces) caused Windows `schtasks.exe` to misparse or truncate arguments.
**Fix:** Bypassed `cmd.exe` and `cd` entirely. Configured `/TR` to directly invoke `javaw.exe` while setting the working directory via the standard JVM parameter `-Duser.dir="<workingDir>"` and pointing `-jar` to `"<workingDir>\server.jar"`, with clean outer quote encapsulation for all paths containing spaces.

## 16. Windows Task Scheduler Unexpanded `%USERNAME%` Variable & Silent Failure in `ProcessCommandRunner`
**Error:** Enabling Auto-Start from the tray icon did not create the task in Windows Task Scheduler, and the tray menu remained stuck on "Enable auto-start" without displaying any error message in the console or logs.
**Why it happened:**
1. **Unexpanded Environment Variable:** In Java, `ProcessBuilder` calls the native Windows `CreateProcessW` API directly without a command shell (`cmd.exe`). Because `schtasks.exe` does not expand shell environment variables, passing the string `"%USERNAME%"` caused `schtasks` to look for a literal account named `"%USERNAME%"`, failing with account lookup / security ID errors.
2. **Discarded Error Streams:** `ProcessCommandRunner` called `pb.start()` and `process.waitFor()` without reading or logging `process.getErrorStream()` or `process.getInputStream()`. When `schtasks` failed with an error, the error message was discarded, making the failure completely silent.
3. **Tray State Desync:** `TrayManager.java` relied on `autoStartManager.isAutoStartEnabled()` (which checks if the task exists via `schtasks /Query`). Because task registration failed silently, the task never existed, so the tray button remained perpetually stuck on "Enable auto-start".
**Fix:** Updated username resolution to use dynamic runtime user properties (`System.getProperty("user.name")`) or omission for current user logon context, captured process error streams to log stderr output upon non-zero exit codes, and updated `TrayManager` to handle toggle status reliably.

## 17. Windows Task Scheduler Argument Splitting on Double-Quotes (`ERROR: Invalid argument/option - 'Files\Eclipse'`)
**Error:**
```text
Command [schtasks, /Create, /F, /TN, PhoneRemote, /SC, ONLOGON, /TR, ""C:\Program Files\Eclipse Adoptium\jdk-17.0.17.10-hotspot\bin\javaw.exe" -Duser.dir="F:\phone pc hypnotiser\server" -jar "..."] failed with exit code -2147467259: ERROR: Invalid argument/option - 'Files\Eclipse'.
```
**Why it happened:** In Windows `schtasks.exe`, wrapping the entire command line in outer quotes with inner quotes (`""<exe>" <args>""`) does not follow standard Windows CLI escaping rules when passed directly via Java's `ProcessBuilder`. Windows parses the initial `""` as an empty argument token, causing the subsequent path `C:\Program Files\...` to be split at the space between `Program` and `Files`, triggering `Invalid argument/option - 'Files\Eclipse'`.
**Fix:** Formatted each argument token independently using single quotes (`'C:\Program Files\...\javaw.exe' '-Duser.dir=...' -jar '...'`) inside `/TR`. Windows Task Scheduler preserves single-quoted tokens as contiguous path literals without splitting on whitespace.

## 18. Unquoted `-Duser.dir` Space Splitting in Task Scheduler (`ERROR: Invalid argument/option - 'pc'`)
**Error:**
```text
Command [schtasks, /Create, /F, /TN, PhoneRemote, /SC, ONLOGON, /TR, 'C:\Program Files\...\javaw.exe' -Duser.dir="F:\phone pc hypnotiser\server" -jar "..."] failed with exit code -2147467259: ERROR: Invalid argument/option - 'pc'.
```
**Why it happened:** Even when the executable path had quotes, passing `-Duser.dir="F:\phone pc hypnotiser\server"` started with `-Duser.dir=` before the quotation mark. Because the quote was not at index 0 of the CLI argument token, `schtasks.exe` did not consider the entire token quoted. It split the string at the space inside `phone pc hypnotiser`, interpreting `- 'pc'` as an invalid `schtasks` parameter.
**Fix:** Wrapped the entire `-Duser.dir` parameter in single quotes: `'-Duser.dir=' + workingDir + ''` (e.g. `'-Duser.dir=F:\phone pc hypnotiser\server'`), protecting spaces across the entire JVM option token.

## 19. Task Scheduler Hardcoded `server.jar` vs Maven Snapshot Target JAR
**Error:** In development, enabling auto-start generated a scheduled task pointing to `<workingDir>\server.jar`, which did not exist on disk because standard Maven builds output to `<workingDir>\target\server-1.0-SNAPSHOT.jar`.
**Why it happened:** `AutoStartManager.java` had hardcoded `new File(workingDir, "server.jar")`. When running during development without a custom release copy script, Task Scheduler was pointed at a non-existent JAR file.
**Fix:** Implemented `resolveServerJar()` in `AutoStartManager.java`:
1. Checks if `<workingDir>\server.jar` exists.
2. If not, checks if `<workingDir>\target\server-1.0-SNAPSHOT.jar` exists.
3. Fallback dynamically resolves the running JAR file from `AutoStartManager.class.getProtectionDomain().getCodeSource().getLocation()`.

## 20. Windows Task Scheduler Access Denied on `/SC ONLOGON` (Administrative Elevation Required)
**Error:** `ERROR: Access is denied.` with exit code 1 or -2147467259 when attempting to create the logon scheduled task from an un-elevated terminal.
**Why it happened:** In Windows, registering scheduled tasks that trigger at user logon (`/SC ONLOGON`) across system boundaries or under specific scheduler namespaces requires administrative privileges. Running the server from a standard non-elevated user terminal causes Task Scheduler to reject task creation with `Access is denied`.
**Fix:** Documented elevation requirements in setup instructions and ensured `TrayManager` reports a warning when `autoStartManager.enableAutoStart()` returns false so users know to run the host server as Administrator when configuring the auto-start task.

## 21. Stale JAR Execution After Source Modifications (Packaging Requirement)
**Error:** Modifications made to Java source files (such as `AutoStartManager.java`) did not take effect when launching `java -jar server/target/server-1.0-SNAPSHOT.jar`.
**Why it happened:** Unlike interpreted languages or IDE hot-reloading, running `java -jar` executes pre-compiled bytecode packaged inside the JAR file on disk. If `mvn package` or `mvn clean package` is not executed after source modifications, the JAR remains stale with old compiled classes.
**Fix:** Documented the mandatory rebuild workflow (`mvn clean package`) before running the JAR, or running tests with `mvn test` to compile and verify changes immediately.

## 22. Windows Firewall Rule Automation vs Administrative Security Boundary
**Error / Dilemma:** Designing an automated script or runtime command to add firewall rules via `netsh advfirewall` required hardcoding firewall commands or asking for root UAC prompts, which breaks unattended execution and risks misconfiguring network security profiles.
**Why it happened:** Windows Defender Firewall rules require full elevated Administrative access and are security-sensitive. Modifying firewall rules programmatically from a user application can trigger antivirus flags or fail silently if permissions are insufficient.
**Fix:** Decided against invasive firewall code automation in favor of clear, concise documentation in `README.md` instructing the user to choose **Private networks only** when prompted on first run, and providing manual instructions under Windows Security to allow Java for private networks if the phone cannot connect.

## 23. PowerShell Parameter Parsing Splits `-D` System Properties (`Unknown lifecycle phase ".awt.headless=true"`)
**Error:** Running `mvn test -Djava.awt.headless=true` failed with:
```text
[ERROR] Unknown lifecycle phase ".awt.headless=true". You must specify a valid lifecycle phase or a goal in the format <plugin-prefix>:<goal>...
```
**Why it happened:** In Windows PowerShell, passing an unquoted parameter with dots such as `-Djava.awt.headless=true` parses `-Djava` as one token and `.awt.headless=true` as a separate argument. Maven then misinterprets `.awt.headless=true` as an invalid build lifecycle phase.
**Fix:** Wrap the entire system property argument in quotes when invoking Maven from PowerShell: `mvn test "-Djava.awt.headless=true"`.

## 24. Spurious `@Override` Annotation on Extracted Static Method
**Error:** Extracting `public static boolean validateOrigin(...)` in `AppConfig.java` triggered a compiler error:
```text
[ERROR] method does not override or implement a method from a supertype
```
**Why it happened:** The static helper method was extracted right above an overridden interface method and accidentally retained the `@Override` annotation. In Java, static methods belong to the class and cannot override interface or superclass instance methods.
**Fix:** Removed the `@Override` annotation from the static `validateOrigin` method.

## 25. Stale `.class` File Timestamps from Git Checkout Suppress `javac` Compilation
**Error:** Test compilation failed with `cannot find symbol` for newly added methods and constructors in `RemoteSocketHandler` and `AppConfig`, even though the source code was clearly modified in `.java` files.
**Why it happened:** Reverting target directory changes via `git checkout -- server/target` restored pre-compiled `.class` files whose file modification timestamps were newer than the `.java` source files. Maven's `compiler:compile` plugin compares timestamps and reported:
`[INFO] Nothing to compile - all classes are up to date`
Because `javac` was skipped for main classes, `testCompile` attempted to compile new unit tests against stale `.class` binaries.
**Fix:** Removed stale compiled binaries via `Remove-Item -Recurse -Force server/target/classes` or running `mvn clean` before compiling.

## 26. Spring Boot Multi-Constructor Injection Failure (`No default constructor found` on `PowerModule`)
**Error:** When launching the packaged JAR with `java -jar target/server-1.0-SNAPSHOT.jar`, Spring Boot aborted startup:
```text
org.springframework.beans.factory.UnsatisfiedDependencyException: Error creating bean with name 'adminController' ...
Error creating bean with name 'powerModule': Failed to instantiate [com.phoneremote.module.impl.PowerModule]: No default constructor found
Caused by: java.lang.NoSuchMethodException: com.phoneremote.module.impl.PowerModule.<init>()
```
**Why it happened:** `PowerModule` was updated to support a secondary constructor for testing:
1. `public PowerModule(PowerAdapter powerAdapter)`
2. `public PowerModule(PowerAdapter powerAdapter, TimeSource timeSource)`
When a `@Component` class has only one constructor, Spring Boot autowires it implicitly. When a class has multiple constructors and none are annotated with `@Autowired`, Spring cannot determine which constructor to invoke and attempts to invoke a default no-argument constructor `PowerModule()`. Because no zero-arg constructor existed, bean instantiation failed.
**Fix:** Added `@Autowired` to the primary constructor `public PowerModule(PowerAdapter powerAdapter)` so Spring Boot explicitly knows which constructor to invoke during dependency injection.

## 27. Java Compiler Synthetic Class Desync (`NoClassDefFoundError: PowerModule$1`)
**Error:**
```text
java.lang.NoClassDefFoundError: com/phoneremote/module/impl/PowerModule$1
    at com.phoneremote.module.impl.PowerModule.executeAction(PowerModule.java:135)
Caused by: java.lang.ClassNotFoundException: com/phoneremote/module/impl/PowerModule$1
```
**Why it happened:** In `PowerModule.executeAction()`, executing a `switch (action)` on an enum caused the Java compiler (`javac`) to generate a synthetic anonymous inner class named `PowerModule$1.class` (containing an enum switch lookup table). When the runtime classloader ran during test execution after clean builds, `PowerModule$1.class` was not resolved, causing `NoClassDefFoundError`.
**Fix:** Replaced the `switch (action)` construct with an `if-else` chain comparing enum constants directly (`if (action == PowerAction.SHUTDOWN) ...`), eliminating compiler-generated synthetic inner classes.

## 28. In-Memory Log Appender Unregistered in Direct `AdminController` Unit Tests
**Error:** In `SecurityTests.testDeviceNamesAndLogLinesHtmlEscapedInAdmin`, calling `controller.apiLogs(req, res)` failed assertion:
`Log line must be HTML-escaped ==> expected: <true> but was: <false>`
**Why it happened:** When `AdminController` was manually instantiated in unit tests via `new AdminController(...)`, the Spring Boot lifecycle hook `@PostConstruct public void initLogging()` was not automatically invoked. As a result, `InMemoryLogAppender` was never registered with the SLF4J Logback context, causing `getEvents()` to return an empty list and assertions to fail.
**Fix:** Manually invoked `controller.initLogging()` and `InMemoryLogAppender.clear()` in the test method before emitting synthetic test log lines.

## 29. Auth Timer Premature Expiry During BCrypt Hash Generation in Tests
**Error:** In `SecurityTests.testUnauthenticatedSocketsClosedAfterTimeout`, Mockito reported that `webSocketSession.close()` was invoked on an authenticated session:
```text
Never wanted here:
-> at SecurityTests.testUnauthenticatedSocketsClosedAfterTimeout
But invoked here:
-> at Session.close()
```
**Why it happened:** The test configured a 100ms timeout on `RemoteSocketHandler`, established a session, and then called `configStore.setPin("123456")`. Computing a salted BCrypt hash and writing the atomic JSON config to disk took longer than 100ms on the test machine, causing the background auth timer to fire and close the socket before the PIN verification message could be processed.
**Fix:** Pre-configured the device record in `configStore` with a pre-computed token before establishing the WebSocket connection, allowing the session to send `hello` and authenticate in sub-milliseconds well before the 100ms timer fired.

