package com.phoneremote.host;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.phoneremote.config.ConfigStore;
import com.phoneremote.module.ModuleRegistry;
import com.phoneremote.terminal.TerminalPromptService;
import com.phoneremote.admin.PendingApprovalStore;
import com.phoneremote.ws.LockoutTracker;
import com.phoneremote.ws.RemoteSocketHandler;
import com.phoneremote.ws.Session;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;

import java.nio.file.Files;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class LayoutTests {

    private ConfigStore configStore;
    private ModuleRegistry registry;
    private RemoteSocketHandler handler;

    @BeforeEach
    void setUp() throws Exception {
        System.setProperty("user.dir", Files.createTempDirectory("phoneremotetest").toString());
        configStore = new ConfigStore();
        registry = new ModuleRegistry();
        
        // Dummy module
        registry.register(new com.phoneremote.module.RemoteModule() {
            @Override public String id() { return "test_module"; }
            @Override public String displayName() { return "Test"; }
            @Override public void onMessage(Session s, String t, com.fasterxml.jackson.databind.JsonNode d) {}
            @Override public void onOpen(Session s) {}
            @Override public void onClose(Session s) {}
        });

        handler = new RemoteSocketHandler(registry, configStore, new LockoutTracker(), mock(TerminalPromptService.class), new PendingApprovalStore());
    }

    @Test
    void testDefaultLayout() {
        ConfigStore.DeviceInfo info = new ConfigStore.DeviceInfo();
        info.deviceId = "dev1";
        configStore.addDevice(info);

        ConfigStore.DeviceInfo loaded = configStore.getDevice("dev1");
        assertNotNull(loaded);
        assertEquals(List.of("screen", "touchpad", "keyboard", "media", "power"), loaded.layout);
    }

    @Test
    void testSetLayoutValidation() throws Exception {
        ConfigStore.DeviceInfo info = new ConfigStore.DeviceInfo();
        info.deviceId = "dev1";
        configStore.addDevice(info);

        WebSocketSession ws = mock(WebSocketSession.class);
        when(ws.getId()).thenReturn("ws-1");
        handler.afterConnectionEstablished(ws);

        // Authenticate manually for test
        java.lang.reflect.Field sessionsField = RemoteSocketHandler.class.getDeclaredField("sessions");
        sessionsField.setAccessible(true);
        @SuppressWarnings("unchecked")
        java.util.Map<String, Session> sessions = (java.util.Map<String, Session>) sessionsField.get(handler);
        Session session = sessions.get("ws-1");
        session.setAuthenticated(true);
        session.setDeviceId("dev1");

        ObjectMapper mapper = new ObjectMapper();
        ObjectNode msg = mapper.createObjectNode();
        msg.put("m", "core");
        msg.put("t", "set_layout");
        ObjectNode d = mapper.createObjectNode();
        ArrayNode layout = mapper.createArrayNode();
        layout.add("test_module");
        layout.add("test_module"); // duplicate
        layout.add("invalid_module"); // unknown
        d.set("layout", layout);
        msg.set("d", d);

        handler.handleMessage(ws, new TextMessage(mapper.writeValueAsString(msg)));

        ConfigStore.DeviceInfo updated = configStore.getDevice("dev1");
        assertEquals(List.of("test_module"), updated.layout);
    }

    @Test
    void testLayoutPersistsReload() throws Exception {
        ConfigStore.DeviceInfo info = new ConfigStore.DeviceInfo();
        info.deviceId = "dev1";
        configStore.addDevice(info);

        configStore.updateDeviceLayout("dev1", List.of("power", "media"));

        ConfigStore loadedStore = new ConfigStore();
        ConfigStore.DeviceInfo loadedInfo = loadedStore.getDevice("dev1");
        assertEquals(List.of("power", "media"), loadedInfo.layout);
    }
}
