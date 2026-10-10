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

    private boolean authenticated = false;
    private String deviceId;

    public Session(WebSocketSession wsSession) {
        this.wsSession = wsSession;
        this.executor = Executors.newSingleThreadExecutor();
    }

    public boolean isAuthenticated() { return authenticated; }
    public void setAuthenticated(boolean authenticated) { this.authenticated = authenticated; }
    public String getDeviceId() { return deviceId; }
    public void setDeviceId(String deviceId) { this.deviceId = deviceId; }

    public String getId() {
        return wsSession.getId();
    }

    public String getRemoteAddressString() {
        if (wsSession.getRemoteAddress() != null) {
            return wsSession.getRemoteAddress().getAddress().getHostAddress();
        }
        return "unknown";
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

    public void sendBinary(byte[] payload) {
        synchronized (wsSession) {
            if (wsSession.isOpen()) {
                try {
                    wsSession.sendMessage(new org.springframework.web.socket.BinaryMessage(payload));
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
        try {
            if (wsSession.isOpen()) wsSession.close();
        } catch (IOException e) {
            // Ignore
        }
    }
}
