package com.phoneremote.ws;

import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;

import java.io.IOException;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class Session {
    private final WebSocketSession wsSession;
    private final ExecutorService executor;
    private final Map<String, Object> attributes = new ConcurrentHashMap<>();

    public Session(WebSocketSession wsSession) {
        this.wsSession = wsSession;
        this.executor = Executors.newSingleThreadExecutor();
    }

    public String getId() {
        return wsSession.getId();
    }

    public void setAttribute(String key, Object value) {
        attributes.put(key, value);
    }

    public Object getAttribute(String key) {
        return attributes.get(key);
    }

    public void removeAttribute(String key) {
        attributes.remove(key);
    }

    public void send(String text) {
        synchronized (wsSession) {
            if (wsSession.isOpen()) {
                try {
                    wsSession.sendMessage(new TextMessage(text));
                } catch (IOException e) {
                    e.printStackTrace();
                }
            }
        }
    }

    public void execute(Runnable task) {
        if (!executor.isShutdown()) {
            executor.submit(task);
        }
    }

    public void close() {
        executor.shutdown();
    }
}
