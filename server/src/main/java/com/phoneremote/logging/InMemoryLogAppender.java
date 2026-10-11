package com.phoneremote.logging;

import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.AppenderBase;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ConcurrentLinkedDeque;

public class InMemoryLogAppender extends AppenderBase<ILoggingEvent> {
    private static final int MAX_SIZE = 500;
    private static final ConcurrentLinkedDeque<ILoggingEvent> events = new ConcurrentLinkedDeque<>();

    @Override
    public synchronized void doAppend(ILoggingEvent eventObject) {
        append(eventObject);
    }

    @Override
    protected void append(ILoggingEvent eventObject) {
        if (eventObject == null) return;
        try {
            eventObject.prepareForDeferredProcessing();
        } catch (Throwable ignored) {
            // In unit tests or uninitialized logback environments, MDC adapter might not be present
        }
        events.addLast(eventObject);
        while (events.size() > MAX_SIZE) {
            events.pollFirst();
        }
    }

    public static List<ILoggingEvent> getEvents() {
        return new ArrayList<>(events);
    }

    public static void clear() {
        events.clear();
    }
}
