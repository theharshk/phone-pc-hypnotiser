package com.phoneremote.ws;

public interface TimeSource {
    long currentTimeMillis();

    TimeSource SYSTEM = System::currentTimeMillis;
}
