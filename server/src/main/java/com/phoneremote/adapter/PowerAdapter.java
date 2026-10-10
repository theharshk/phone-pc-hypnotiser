package com.phoneremote.adapter;

public interface PowerAdapter {
    void shutdown();
    void restart();
    void sleep();
    void hibernate();
    void lock();
    void cancelPending();
}
