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
    protected void append(ILoggingEvent eventObject) {
        // Must explicitly prepare for deferred processing so message is formatted if params are present
        eventObject.prepareForDeferredProcessing();
        events.addLast(eventObject);
        while (events.size() > MAX_SIZE) {
            events.pollFirst();
        }
    }

    public static List<ILoggingEvent> getEvents() {
        return new ArrayList<>(events);
    }
}
