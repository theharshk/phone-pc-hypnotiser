package com.phoneremote.admin;

import org.springframework.stereotype.Component;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Consumer;

@Component
public class PendingApprovalStore {

    public static class PendingDevice {
        public String deviceId;
        public String name;
        public String ip;
        public Consumer<Boolean> callback;
    }

    private final Map<String, PendingDevice> pending = new ConcurrentHashMap<>();

    public void add(PendingDevice device) {
        pending.put(device.deviceId, device);
    }

    public Map<String, PendingDevice> getAll() {
        return pending;
    }

    public void resolve(String deviceId, boolean approved) {
        PendingDevice dev = pending.remove(deviceId);
        if (dev != null) {
            dev.callback.accept(approved);
        }
    }
}
