package com.phoneremote.auth;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.phoneremote.config.ConfigStore;
import com.phoneremote.module.ModuleRegistry;
import com.phoneremote.terminal.TerminalPromptService;
import com.phoneremote.ws.LockoutTracker;
import com.phoneremote.ws.RemoteSocketHandler;
import com.phoneremote.ws.Session;
import com.phoneremote.ws.TimeSource;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;

import java.io.File;
import java.nio.file.Files;
import java.util.List;
import java.util.concurrent.CompletableFuture;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

class AuthTests {

    private ConfigStore configStore;
    private LockoutTracker lockoutTracker;

    @BeforeEach
    void setUp() throws Exception {
        System.setProperty("user.dir", Files.createTempDirectory("phoneremotetest").toString());
        configStore = new ConfigStore();
        lockoutTracker = new LockoutTracker();
    }

    @Test
    void testAtomicConfigWrite() throws Exception {
        configStore.setPin("123456");
        assertTrue(configStore.isPinSet());
        File configJson = new File(System.getProperty("user.dir"), "config.json");
        assertTrue(configJson.exists());
        
        ConfigStore loadedStore = new ConfigStore();
        assertTrue(loadedStore.isPinSet());
        assertTrue(loadedStore.verifyPin("123456"));
    }

    @Test
    void testPinHashing() {
        configStore.setPin("654321");
        assertTrue(configStore.verifyPin("654321"));
        assertFalse(configStore.verifyPin("111111"));
        assertFalse(configStore.verifyPin("65432"));
    }

    @Test
    void testTokenVerifyAndRevoke() {
        String deviceId = "dev-1";
        String tokenRaw = "secret_token_123";
        ConfigStore.DeviceInfo info = new ConfigStore.DeviceInfo();
        info.deviceId = deviceId;
        info.tokenHash = configStore.hashToken(tokenRaw);
        configStore.addDevice(info);

        assertTrue(configStore.verifyDeviceToken(deviceId, tokenRaw, "1.2.3.4"));
        assertFalse(configStore.verifyDeviceToken(deviceId, "wrong_token", "1.2.3.4"));

        configStore.removeDevice(deviceId);
        assertFalse(configStore.verifyDeviceToken(deviceId, tokenRaw, "1.2.3.4"));
    }

    @Test
    void testLockoutDoubling() {
        String ip = "IP:10.0.0.1";
        assertEquals(0, lockoutTracker.getLockoutRemaining(ip));

        for (int i=0; i<4; i++) lockoutTracker.recordStrike(ip);
        assertFalse(lockoutTracker.isLockedOut(ip));

        lockoutTracker.recordStrike(ip); // 5th strike -> 5 min
        assertTrue(lockoutTracker.isLockedOut(ip));
        long remain = lockoutTracker.getLockoutRemaining(ip);
        assertTrue(remain > 0 && remain <= 5 * 60 * 1000L);

        lockoutTracker.recordStrike(ip); // 6th strike -> 10 min
        long remain2 = lockoutTracker.getLockoutRemaining(ip);
        assertTrue(remain2 > 5 * 60 * 1000L && remain2 <= 10 * 60 * 1000L);
        
        lockoutTracker.clearStrikes(ip);
        assertFalse(lockoutTracker.isLockedOut(ip));
    }

    @Test
    void testRejectPreAuthMessages() throws Exception {
        TerminalPromptService promptService = mock(TerminalPromptService.class);
        ModuleRegistry registry = new ModuleRegistry(java.util.Collections.emptyList());
        RemoteSocketHandler handler = new RemoteSocketHandler(registry, configStore, lockoutTracker, promptService);

        WebSocketSession ws = mock(WebSocketSession.class);
        when(ws.getId()).thenReturn("ws-1");
        handler.afterConnectionEstablished(ws);

        ObjectMapper mapper = new ObjectMapper();
        ObjectNode malicious = mapper.createObjectNode();
        malicious.put("m", "power");
        malicious.put("t", "execute");
        
        // Should ignore without error, not processing it.
        handler.handleMessage(ws, new TextMessage(mapper.writeValueAsString(malicious)));
        
        // Let's also check if 'open' is rejected
        ObjectNode openMsg = mapper.createObjectNode();
        openMsg.put("m", "core");
        openMsg.put("t", "open");
        handler.handleMessage(ws, new TextMessage(mapper.writeValueAsString(openMsg)));
        
        // Assert ws.sendMessage was not called (except possibly ping/pong which we didn't send)
        verify(ws, never()).sendMessage(any());
    }

    @Test
    void testSessionRevokedSendsMessageClosesAndCallsModulesOnClose() throws Exception {
        String deviceId = "dev-revoked-1";
        String tokenRaw = "token_abc";
        ConfigStore.DeviceInfo info = new ConfigStore.DeviceInfo();
        info.deviceId = deviceId;
        info.tokenHash = configStore.hashToken(tokenRaw);
        configStore.addDevice(info);

        com.phoneremote.module.RemoteModule mockModule = mock(com.phoneremote.module.RemoteModule.class);
        when(mockModule.id()).thenReturn("test_mod");
        when(mockModule.displayName()).thenReturn("Test Mod");
        ModuleRegistry registry = new ModuleRegistry(List.of(mockModule));

        TerminalPromptService promptService = mock(TerminalPromptService.class);
        RemoteSocketHandler handler = new RemoteSocketHandler(registry, configStore, lockoutTracker, promptService);

        WebSocketSession ws = mock(WebSocketSession.class);
        when(ws.getId()).thenReturn("ws-revoked");
        when(ws.isOpen()).thenReturn(true);
        handler.afterConnectionEstablished(ws);

        ObjectMapper mapper = new ObjectMapper();
        ObjectNode helloMsg = mapper.createObjectNode();
        helloMsg.put("m", "core");
        helloMsg.put("t", "hello");
        ObjectNode helloData = mapper.createObjectNode();
        helloData.put("deviceId", deviceId);
        helloData.put("token", tokenRaw);
        helloData.put("deviceName", "Test Device");
        helloMsg.set("d", helloData);

        handler.handleMessage(ws, new TextMessage(mapper.writeValueAsString(helloMsg)));

        // Verify connected and authenticated
        assertEquals(1, handler.getActiveSessionCount());

        // Revoke the device
        configStore.removeDevice(deviceId);
        handler.revokeDevice(deviceId);

        // Verify session receives error message with revoked
        org.mockito.ArgumentCaptor<TextMessage> textCaptor = org.mockito.ArgumentCaptor.forClass(TextMessage.class);
        verify(ws, atLeastOnce()).sendMessage(textCaptor.capture());
        boolean foundRevoked = false;
        for (TextMessage tm : textCaptor.getAllValues()) {
            com.fasterxml.jackson.databind.JsonNode node = mapper.readTree(tm.getPayload());
            if ("core".equals(node.path("m").asText()) && "error".equals(node.path("t").asText())) {
                if ("revoked".equals(node.path("d").path("code").asText()) || "revoked".equals(node.path("d").path("type").asText())) {
                    foundRevoked = true;
                    break;
                }
            }
        }
        assertTrue(foundRevoked, "Expected revoked error message sent to WebSocket");

        // Verify mockModule onClose was called
        verify(mockModule, times(1)).onClose(any(Session.class));

        // Verify active session count dropped to 0
        assertEquals(0, handler.getActiveSessionCount());

        // Verify ws was closed
        verify(ws, times(1)).close();

        // Verify revoked token is now rejected on new hello
        WebSocketSession wsNew = mock(WebSocketSession.class);
        when(wsNew.getId()).thenReturn("ws-new");
        when(wsNew.isOpen()).thenReturn(true);
        handler.afterConnectionEstablished(wsNew);
        handler.handleMessage(wsNew, new TextMessage(mapper.writeValueAsString(helloMsg)));

        org.mockito.ArgumentCaptor<TextMessage> newTextCaptor = org.mockito.ArgumentCaptor.forClass(TextMessage.class);
        verify(wsNew, atLeastOnce()).sendMessage(newTextCaptor.capture());
        boolean newRejected = false;
        for (TextMessage tm : newTextCaptor.getAllValues()) {
            com.fasterxml.jackson.databind.JsonNode node = mapper.readTree(tm.getPayload());
            if ("core".equals(node.path("m").asText()) && "error".equals(node.path("t").asText())
                    && ("revoked".equals(node.path("d").path("code").asText()) || "revoked".equals(node.path("d").path("type").asText()))) {
                newRejected = true;
                break;
            }
        }
        assertTrue(newRejected, "Expected rejected error message on hello for revoked token");
        assertEquals(0, handler.getActiveSessionCount());
    }

    @Test
    void testPingSafetyNetDetectsRevocation() throws Exception {
        String deviceId = "dev-ping-safety";
        String tokenRaw = "token_xyz";
        ConfigStore.DeviceInfo info = new ConfigStore.DeviceInfo();
        info.deviceId = deviceId;
        info.tokenHash = configStore.hashToken(tokenRaw);
        configStore.addDevice(info);

        com.phoneremote.module.RemoteModule mockModule = mock(com.phoneremote.module.RemoteModule.class);
        when(mockModule.id()).thenReturn("test_mod2");
        when(mockModule.displayName()).thenReturn("Test Mod 2");
        ModuleRegistry registry = new ModuleRegistry(List.of(mockModule));

        RemoteSocketHandler handler = new RemoteSocketHandler(registry, configStore, lockoutTracker, mock(TerminalPromptService.class));
        WebSocketSession ws = mock(WebSocketSession.class);
        when(ws.getId()).thenReturn("ws-ping");
        when(ws.isOpen()).thenReturn(true);
        handler.afterConnectionEstablished(ws);

        ObjectMapper mapper = new ObjectMapper();
        ObjectNode helloMsg = mapper.createObjectNode();
        helloMsg.put("m", "core");
        helloMsg.put("t", "hello");
        ObjectNode helloData = mapper.createObjectNode();
        helloData.put("deviceId", deviceId);
        helloData.put("token", tokenRaw);
        helloMsg.set("d", helloData);
        handler.handleMessage(ws, new TextMessage(mapper.writeValueAsString(helloMsg)));

        assertEquals(1, handler.getActiveSessionCount());

        // Device record removed behind the scenes without direct socketHandler.revokeDevice
        configStore.removeDevice(deviceId);

        // Ping arrives
        ObjectNode pingMsg = mapper.createObjectNode();
        pingMsg.put("m", "core");
        pingMsg.put("t", "ping");
        pingMsg.put("i", 12345);
        handler.handleMessage(ws, new TextMessage(mapper.writeValueAsString(pingMsg)));

        // Safety net should have revoked the session
        assertEquals(0, handler.getActiveSessionCount());
        verify(mockModule, times(1)).onClose(any(Session.class));
        verify(ws, times(1)).close();
    }

    static class MutableTimeSource implements TimeSource {
        long current = 1000000L;
        @Override
        public long currentTimeMillis() {
            return current;
        }
    }

    @Test
    void testLockoutBehaviorWithFakeClock() throws Exception {
        MutableTimeSource fakeClock = new MutableTimeSource();
        long shortLockoutMs = 2000L; // 2 seconds
        LockoutTracker tracker = new LockoutTracker(fakeClock, shortLockoutMs, 100000L);

        configStore.setPin("123456");
        RemoteSocketHandler handler = new RemoteSocketHandler(
                new ModuleRegistry(java.util.Collections.emptyList()),
                configStore,
                tracker,
                mock(TerminalPromptService.class)
        );

        WebSocketSession ws = mock(WebSocketSession.class);
        when(ws.getId()).thenReturn("ws-lockout-test");
        when(ws.isOpen()).thenReturn(true);
        handler.afterConnectionEstablished(ws);

        ObjectMapper mapper = new ObjectMapper();

        // Helper to send a PIN
        java.util.function.Consumer<String> sendPin = (pinValue) -> {
            try {
                ObjectNode msg = mapper.createObjectNode();
                msg.put("m", "core");
                msg.put("t", "pin");
                ObjectNode d = mapper.createObjectNode();
                d.put("pin", pinValue);
                d.put("deviceId", "dev-test");
                msg.set("d", d);
                handler.handleMessage(ws, new TextMessage(mapper.writeValueAsString(msg)));
            } catch (Exception e) {
                throw new RuntimeException(e);
            }
        };

        // a. 5 wrong PINs trigger locked_out with retryAfterSeconds equal to the first lockout (2 seconds)
        for (int i = 0; i < 4; i++) {
            sendPin.accept("999999");
        }
        assertFalse(tracker.isLockedOut("DEV:dev-test"));

        // 5th wrong PIN
        sendPin.accept("999999");
        assertTrue(tracker.isLockedOut("DEV:dev-test"));

        org.mockito.ArgumentCaptor<TextMessage> textCaptor = org.mockito.ArgumentCaptor.forClass(TextMessage.class);
        verify(ws, atLeastOnce()).sendMessage(textCaptor.capture());
        TextMessage lastMsg = textCaptor.getValue();
        com.fasterxml.jackson.databind.JsonNode node = mapper.readTree(lastMsg.getPayload());
        assertEquals("error", node.path("t").asText());
        assertEquals("locked_out", node.path("d").path("code").asText());
        assertEquals(2, node.path("d").path("retryAfterSeconds").asInt());

        // b. A correct PIN during the lockout still gets locked_out and does not pair
        Mockito.clearInvocations(ws);
        when(ws.isOpen()).thenReturn(true);
        sendPin.accept("123456");
        verify(ws, atLeastOnce()).sendMessage(textCaptor.capture());
        TextMessage duringMsg = textCaptor.getValue();
        com.fasterxml.jackson.databind.JsonNode duringNode = mapper.readTree(duringMsg.getPayload());
        assertEquals("error", duringNode.path("t").asText());
        assertEquals("locked_out", duringNode.path("d").path("code").asText());
        assertEquals(0, handler.getActiveSessionCount());

        // c. A PIN sent during the lockout does not increase the failure count and does not extend the lockout
        long remainBefore = tracker.getLockoutRemaining("DEV:dev-test");
        sendPin.accept("000000"); // wrong PIN during lockout
        long remainAfter = tracker.getLockoutRemaining("DEV:dev-test");
        assertEquals(remainBefore, remainAfter);

        // d. After the fake clock passes the lockout, a correct PIN pairs
        fakeClock.current += 2500L; // advance clock by 2.5s (> 2.0s)
        assertFalse(tracker.isLockedOut("DEV:dev-test"));

        Mockito.clearInvocations(ws);
        when(ws.isOpen()).thenReturn(true);
        sendPin.accept("123456"); // correct PIN
        verify(ws, atLeastOnce()).sendMessage(textCaptor.capture());
        boolean paired = false;
        for (TextMessage tm : textCaptor.getAllValues()) {
            com.fasterxml.jackson.databind.JsonNode n = mapper.readTree(tm.getPayload());
            if ("paired".equals(n.path("t").asText())) paired = true;
        }
        assertTrue(paired, "Should receive paired message after lockout expired");
        assertEquals(1, handler.getActiveSessionCount());

        // e. After a second round of failures, the lockout doubles (4 seconds)
        // Reset session by creating new connection
        WebSocketSession ws2 = mock(WebSocketSession.class);
        when(ws2.getId()).thenReturn("ws-lockout-test2");
        when(ws2.isOpen()).thenReturn(true);
        handler.afterConnectionEstablished(ws2);

        java.util.function.Consumer<String> sendPin2 = (pinValue) -> {
            try {
                ObjectNode msg = mapper.createObjectNode();
                msg.put("m", "core");
                msg.put("t", "pin");
                ObjectNode d = mapper.createObjectNode();
                d.put("pin", pinValue);
                d.put("deviceId", "dev-test-2");
                msg.set("d", d);
                handler.handleMessage(ws2, new TextMessage(mapper.writeValueAsString(msg)));
            } catch (Exception e) {
                throw new RuntimeException(e);
            }
        };

        // First round: 5 strikes -> 2 seconds lockout
        for (int i = 0; i < 5; i++) {
            sendPin2.accept("000000");
        }
        assertEquals(2000L, tracker.getLockoutRemaining("DEV:dev-test-2"));

        // Advance fake clock past the first lockout
        fakeClock.current += 2500L;
        assertFalse(tracker.isLockedOut("DEV:dev-test-2"));

        // 6th strike (second round failure) -> doubles to 4 seconds
        sendPin2.accept("000000");
        assertEquals(4000L, tracker.getLockoutRemaining("DEV:dev-test-2"));

        org.mockito.ArgumentCaptor<TextMessage> textCaptor2 = org.mockito.ArgumentCaptor.forClass(TextMessage.class);
        verify(ws2, atLeastOnce()).sendMessage(textCaptor2.capture());
        TextMessage doubledMsg = textCaptor2.getValue();
        com.fasterxml.jackson.databind.JsonNode doubledNode = mapper.readTree(doubledMsg.getPayload());
        assertEquals("error", doubledNode.path("t").asText());
        assertEquals("locked_out", doubledNode.path("d").path("code").asText());
        assertEquals(4, doubledNode.path("d").path("retryAfterSeconds").asInt());
    }
}
