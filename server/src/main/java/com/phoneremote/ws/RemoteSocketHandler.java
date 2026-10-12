package com.phoneremote.ws;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.phoneremote.config.ConfigStore;
import com.phoneremote.module.ModuleRegistry;
import com.phoneremote.module.RemoteModule;
import com.phoneremote.terminal.TerminalPromptService;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import java.security.SecureRandom;
import java.util.Base64;
import java.util.Map;
import java.util.Timer;
import java.util.TimerTask;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

@Component
public class RemoteSocketHandler extends TextWebSocketHandler {

    private final ObjectMapper mapper = new ObjectMapper();
    private final ModuleRegistry moduleRegistry;
    private final ConfigStore configStore;
    private final LockoutTracker lockoutTracker;
    private final TerminalPromptService promptService;

    private final Map<String, Session> sessions = new ConcurrentHashMap<>();
    private final Map<String, java.util.Set<Session>> deviceSessions = new ConcurrentHashMap<>();
    private final Map<String, PendingApproval> pendingApprovals = new ConcurrentHashMap<>();
    private final Timer authTimer = new Timer(true);
    private static final int MAX_PAYLOAD_LENGTH = 262144; // 256 KB safe limit for text payloads
    private volatile boolean remoteControlEnabled = true;

    public static class PendingApproval {
        public final String deviceId;
        public final String deviceName;
        public final String ip;
        public final Session session;

        public PendingApproval(String deviceId, String deviceName, String ip, Session session) {
            this.deviceId = deviceId;
            this.deviceName = deviceName;
            this.ip = ip;
            this.session = session;
        }
    }

    public boolean isRemoteControlEnabled() {
        return remoteControlEnabled;
    }

    public void setRemoteControlEnabled(boolean enabled) {
        this.remoteControlEnabled = enabled;
        if (!enabled) {
            java.util.List<Session> all = new java.util.ArrayList<>(sessions.values());
            for (Session s : all) {
                try {
                    sendError(s, "paused");
                } catch (Exception ignored) {}
                for (RemoteModule m : moduleRegistry.getAll()) {
                    try {
                        m.onClose(s);
                    } catch (Exception ignored) {}
                }
                String deviceId = s.getDeviceId();
                if (deviceId != null) {
                    unregisterDeviceSession(deviceId, s);
                }
                s.setAuthenticated(false);
                try {
                    s.close();
                } catch (Exception ignored) {}
            }
            sessions.clear();
            pendingApprovals.clear();
        }
    }

    public java.util.Collection<PendingApproval> getPendingApprovals() {
        return pendingApprovals.values();
    }

    public boolean approvePendingDevice(String deviceId) {
        PendingApproval p = pendingApprovals.remove(deviceId);
        if (p != null && p.session.isOpen()) {
            try {
                pairDevice(p.session, p.deviceId, p.deviceName, p.ip);
                return true;
            } catch (Exception ignored) {}
        }
        return false;
    }

    public boolean rejectPendingDevice(String deviceId) {
        PendingApproval p = pendingApprovals.remove(deviceId);
        if (p != null && p.session.isOpen()) {
            try {
                sendError(p.session, "revoked");
                p.session.close();
                return true;
            } catch (Exception ignored) {}
        }
        return false;
    }

    public void cleanShutdown() {
        for (Session s : new java.util.ArrayList<>(sessions.values())) {
            for (RemoteModule m : moduleRegistry.getAll()) {
                try {
                    m.onClose(s);
                } catch (Exception ignored) {}
            }
            try {
                s.close();
            } catch (Exception ignored) {}
        }
        sessions.clear();
        deviceSessions.clear();
        pendingApprovals.clear();
    }

    public int getActiveSessionCount() {
        return (int) sessions.values().stream().filter(Session::isAuthenticated).count();
    }

    private void registerDeviceSession(String deviceId, Session session) {
        if (deviceId != null && !deviceId.isEmpty()) {
            deviceSessions.computeIfAbsent(deviceId, k -> ConcurrentHashMap.newKeySet()).add(session);
        }
    }

    private void unregisterDeviceSession(String deviceId, Session session) {
        if (deviceId != null) {
            java.util.Set<Session> set = deviceSessions.get(deviceId);
            if (set != null) {
                set.remove(session);
                if (set.isEmpty()) {
                    deviceSessions.remove(deviceId, set);
                }
            }
        }
    }

    public RemoteSocketHandler(ModuleRegistry moduleRegistry, ConfigStore configStore, LockoutTracker lockoutTracker, TerminalPromptService promptService) {
        this.moduleRegistry = moduleRegistry;
        this.configStore = configStore;
        this.lockoutTracker = lockoutTracker;
        this.promptService = promptService;
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession wsSession) throws Exception {
        if (!remoteControlEnabled) {
            wsSession.close();
            return;
        }
        Session session = new Session(wsSession);
        sessions.put(wsSession.getId(), session);

        authTimer.schedule(new TimerTask() {
            @Override
            public void run() {
                if (!session.isAuthenticated()) {
                    session.close();
                }
            }
        }, 60000); // 60 seconds timeout
    }

    @Override
    protected void handleTextMessage(WebSocketSession wsSession, TextMessage message) throws Exception {
        if (!remoteControlEnabled) {
            wsSession.close();
            return;
        }
        String payload = message.getPayload();
        if (payload.length() > MAX_PAYLOAD_LENGTH) {
            wsSession.close(CloseStatus.BAD_DATA.withReason("Message too large"));
            return;
        }

        Session session = sessions.get(wsSession.getId());
        if (session == null) return;

        try {
            JsonNode root = mapper.readTree(payload);
            String m = root.path("m").asText("");
            String t = root.path("t").asText("");
            JsonNode d = root.path("d");

            if (!session.isAuthenticated()) {
                if (!"core".equals(m) || (!"hello".equals(t) && !"pin".equals(t) && !"ping".equals(t))) {
                    return; // Reject pre-auth
                }
            }

            if ("core".equals(m)) {
                handleCoreMessage(session, root, t, d);
            } else {
                RemoteModule module = moduleRegistry.get(m);
                if (module != null) {
                    if ("keyboard".equals(m) && "cancel_stream".equals(t)) {
                        try {
                            module.onMessage(session, t, d);
                        } catch (Exception ignored) {}
                    } else {
                        session.execute(() -> {
                            try {
                                module.onMessage(session, t, d);
                            } catch (Exception e) {
                                System.err.println("Module error: " + e.getMessage());
                            }
                        });
                    }
                }
            }
        } catch (Exception e) {
            // Ignore parse errors
        }
    }

    private void handleCoreMessage(Session session, JsonNode root, String t, JsonNode d) throws Exception {
        if ("hello".equals(t)) {
            String deviceName = d.path("deviceName").asText("Unknown Device");
            session.setAttribute("deviceName", deviceName);
            String token = d.path("token").asText("");
            String deviceId = d.path("deviceId").asText("");
            String ip = session.getRemoteAddressString();

            if (!token.isEmpty() && !deviceId.isEmpty()) {
                if (configStore.verifyDeviceToken(deviceId, token, ip)) {
                    session.setAuthenticated(true);
                    session.setDeviceId(deviceId);
                    registerDeviceSession(deviceId, session);
                    sendReady(session);
                } else {
                    sendError(session, "revoked");
                }
            } else {
                // Not paired yet
                if (configStore.isPinSet()) {
                    String keyIp = "IP:" + ip;
                    String keyDevice = "DEV:" + deviceId;
                    String keyGlobal = "GLOBAL";
                    long remain = getLockoutRemaining(keyIp, keyDevice, keyGlobal);
                    if (remain > 0) {
                        int retrySec = (int) Math.ceil(remain / 1000.0);
                        sendLockedOutError(session, retrySec);
                        return;
                    }

                    ObjectNode response = mapper.createObjectNode();
                    response.put("m", "core");
                    response.put("t", "need_pin");
                    session.send(mapper.writeValueAsString(response));
                } else {
                    // No-PIN mode: requires approval on laptop (Admin page)
                    String finalDeviceId = deviceId.isEmpty() ? UUID.randomUUID().toString() : deviceId;
                    session.setAttribute("pendingDeviceId", finalDeviceId);
                    PendingApproval pending = new PendingApproval(finalDeviceId, deviceName, ip, session);
                    pendingApprovals.put(finalDeviceId, pending);

                    ObjectNode response = mapper.createObjectNode();
                    response.put("m", "core");
                    response.put("t", "pending_approval");
                    session.send(mapper.writeValueAsString(response));
                }
            }
        } else if ("pin".equals(t)) {
            String pin = d.path("pin").asText("");
            String deviceId = d.path("deviceId").asText("");
            String ip = session.getRemoteAddressString();
            String deviceName = (String) session.getAttribute("deviceName");

            String keyIp = "IP:" + ip;
            String keyDevice = "DEV:" + deviceId;
            String keyGlobal = "GLOBAL";

            long remain = getLockoutRemaining(keyIp, keyDevice, keyGlobal);
            if (remain > 0) {
                int retrySec = (int) Math.ceil(remain / 1000.0);
                sendLockedOutError(session, retrySec);
                return;
            }

            if (configStore.verifyPin(pin)) {
                lockoutTracker.clearStrikes(keyIp);
                lockoutTracker.clearStrikes(keyDevice);
                lockoutTracker.clearStrikes(keyGlobal);
                pairDevice(session, deviceId, deviceName, ip);
            } else {
                lockoutTracker.recordStrike(keyIp);
                lockoutTracker.recordStrike(keyDevice);
                lockoutTracker.recordStrike(keyGlobal);
                long newRemain = getLockoutRemaining(keyIp, keyDevice, keyGlobal);
                if (newRemain > 0) {
                    int retrySec = (int) Math.ceil(newRemain / 1000.0);
                    sendLockedOutError(session, retrySec);
                } else {
                    sendError(session, "bad_pin");
                }
            }

        } else if ("ping".equals(t)) {
            if (session.isAuthenticated()) {
                String devId = session.getDeviceId();
                if (devId == null || configStore.getDevice(devId) == null) {
                    revokeSession(session);
                    return;
                }
            }
            ObjectNode response = mapper.createObjectNode();
            response.put("m", "core");
            response.put("t", "pong");
            if (root.has("i")) response.set("i", root.get("i"));
            session.send(mapper.writeValueAsString(response));
        } else if ("open".equals(t) && session.isAuthenticated()) {
            String moduleId = d.path("module").asText("");
            RemoteModule module = moduleRegistry.get(moduleId);
            if (module != null) session.execute(() -> module.onOpen(session));
        } else if ("close".equals(t) && session.isAuthenticated()) {
            String moduleId = d.path("module").asText("");
            RemoteModule module = moduleRegistry.get(moduleId);
            if (module != null) session.execute(() -> module.onClose(session));
        } else if ("get_layout".equals(t) && session.isAuthenticated()) {
            ConfigStore.DeviceInfo dInfo = configStore.getDevice(session.getDeviceId());
            if (dInfo != null) {
                ObjectNode response = mapper.createObjectNode();
                response.put("m", "core");
                response.put("t", "layout");
                ObjectNode dNode = mapper.createObjectNode();
                
                ArrayNode layoutArr = mapper.createArrayNode();
                for (String modId : dInfo.layout) {
                    layoutArr.add(modId);
                }
                dNode.set("layout", layoutArr);

                ArrayNode availArr = mapper.createArrayNode();
                for (RemoteModule mod : moduleRegistry.getAll()) {
                    ObjectNode mObj = mapper.createObjectNode();
                    mObj.put("id", mod.id());
                    mObj.put("name", mod.displayName());
                    availArr.add(mObj);
                }
                dNode.set("available", availArr);
                
                response.set("d", dNode);
                session.send(mapper.writeValueAsString(response));
            }
        } else if ("set_layout".equals(t) && session.isAuthenticated()) {
            JsonNode layoutNode = d.path("layout");
            if (layoutNode.isArray()) {
                java.util.List<String> newLayout = new java.util.ArrayList<>();
                for (JsonNode n : layoutNode) {
                    String modId = n.asText();
                    if (newLayout.size() < 20 && !newLayout.contains(modId) && moduleRegistry.get(modId) != null) {
                        newLayout.add(modId);
                    }
                }
                configStore.updateDeviceLayout(session.getDeviceId(), newLayout);
            }
        } else if ("unpair".equals(t) && session.isAuthenticated()) {
            String deviceId = session.getDeviceId();
            if (deviceId == null || deviceId.isEmpty()) {
                deviceId = d.path("deviceId").asText("");
            }
            if (deviceId != null && !deviceId.isEmpty()) {
                configStore.removeDevice(deviceId);
                revokeDevice(deviceId);
            }
            if (session.isAuthenticated()) {
                revokeSession(session);
            }
        }
    }

    private void pairDevice(Session session, String deviceId, String name, String ip) {
        if (deviceId == null || deviceId.isEmpty()) {
            deviceId = UUID.randomUUID().toString();
        }
        SecureRandom sr = new SecureRandom();
        byte[] tBytes = new byte[32];
        sr.nextBytes(tBytes);
        String token = Base64.getUrlEncoder().withoutPadding().encodeToString(tBytes);

        ConfigStore.DeviceInfo info = new ConfigStore.DeviceInfo();
        info.deviceId = deviceId;
        info.name = name;
        info.tokenHash = configStore.hashToken(token);
        info.created = System.currentTimeMillis();
        info.lastSeen = info.created;
        info.lastIp = ip;
        configStore.addDevice(info);

        session.setAuthenticated(true);
        session.setDeviceId(deviceId);
        registerDeviceSession(deviceId, session);

        try {
            ObjectNode response = mapper.createObjectNode();
            response.put("m", "core");
            response.put("t", "paired");
            ObjectNode data = mapper.createObjectNode();
            data.put("token", token);
            data.put("deviceId", deviceId);
            response.set("d", data);
            session.send(mapper.writeValueAsString(response));
        } catch (Exception e) {}
    }

    private long getLockoutRemaining(String keyIp, String keyDevice, String keyGlobal) {
        long remIp = lockoutTracker.getLockoutRemaining(keyIp);
        long remDev = lockoutTracker.getLockoutRemaining(keyDevice);
        long remGlob = lockoutTracker.getLockoutRemaining(keyGlobal);
        return Math.max(remIp, Math.max(remDev, remGlob));
    }

    private void sendLockedOutError(Session session, int retryAfterSeconds) {
        try {
            ObjectNode response = mapper.createObjectNode();
            response.put("m", "core");
            response.put("t", "error");
            ObjectNode data = mapper.createObjectNode();
            data.put("type", "locked_out");
            data.put("code", "locked_out");
            data.put("retryAfterSeconds", retryAfterSeconds);
            response.set("d", data);
            session.send(mapper.writeValueAsString(response));
        } catch (Exception e) {}
    }

    private void sendError(Session session, String errType) {
        try {
            ObjectNode response = mapper.createObjectNode();
            response.put("m", "core");
            response.put("t", "error");
            ObjectNode data = mapper.createObjectNode();
            data.put("type", errType);
            data.put("code", errType);
            response.set("d", data);
            session.send(mapper.writeValueAsString(response));
        } catch (Exception e) {}
    }

    public void revokeSession(Session session) {
        if (session == null) return;
        String deviceId = session.getDeviceId();
        unregisterDeviceSession(deviceId, session);
        sendError(session, "revoked");
        for (RemoteModule module : moduleRegistry.getAll()) {
            try {
                module.onClose(session);
            } catch (Exception e) {
                System.err.println("Module error on revoke: " + e.getMessage());
            }
        }
        session.setAuthenticated(false);
        session.setDeviceId(null);
        session.close();
    }

    public void revokeDevice(String deviceId) {
        if (deviceId == null) return;
        java.util.Set<Session> devSessions = deviceSessions.remove(deviceId);
        if (devSessions != null) {
            for (Session session : devSessions) {
                revokeSession(session);
            }
        }
    }

    public void revokeAllDevices() {
        java.util.List<Session> all = new java.util.ArrayList<>();
        for (java.util.Set<Session> set : deviceSessions.values()) {
            all.addAll(set);
        }
        deviceSessions.clear();
        for (Session s : all) {
            revokeSession(s);
        }
    }

    private void sendReady(Session session) throws Exception {
        ObjectNode response = mapper.createObjectNode();
        response.put("m", "core");
        response.put("t", "ready");

        ObjectNode data = mapper.createObjectNode();
        ArrayNode modulesArr = mapper.createArrayNode();
        for (RemoteModule mod : moduleRegistry.getAll()) {
            ObjectNode mObj = mapper.createObjectNode();
            mObj.put("id", mod.id());
            mObj.put("name", mod.displayName());
            modulesArr.add(mObj);
        }
        data.set("modules", modulesArr);

        ConfigStore.DeviceInfo dInfo = configStore.getDevice(session.getDeviceId());
        if (dInfo != null && dInfo.layout != null) {
            ArrayNode layoutArr = mapper.createArrayNode();
            for (String modId : dInfo.layout) {
                layoutArr.add(modId);
            }
            data.set("layout", layoutArr);
        }

        response.set("d", data);

        session.send(mapper.writeValueAsString(response));
    }

    @Override
    public void afterConnectionClosed(WebSocketSession wsSession, CloseStatus status) throws Exception {
        Session session = sessions.remove(wsSession.getId());
        if (session != null) {
            String pendingDevId = (String) session.getAttribute("pendingDeviceId");
            if (pendingDevId != null) {
                pendingApprovals.remove(pendingDevId);
            }
            unregisterDeviceSession(session.getDeviceId(), session);
            if (session.isAuthenticated()) {
                for (RemoteModule module : moduleRegistry.getAll()) {
                    module.onClose(session);
                }
            }
            session.close();
        }
    }
}
