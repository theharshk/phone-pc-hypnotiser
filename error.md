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
