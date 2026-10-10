package com.phoneremote.auth;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.phoneremote.admin.PendingApprovalStore;
import com.phoneremote.config.ConfigStore;
import com.phoneremote.module.ModuleRegistry;
import com.phoneremote.terminal.TerminalPromptService;
import com.phoneremote.ws.LockoutTracker;
import com.phoneremote.ws.RemoteSocketHandler;
import com.phoneremote.ws.Session;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;

import java.io.File;
import java.nio.file.Files;
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
        PendingApprovalStore pendingApprovalStore = new PendingApprovalStore();
        ModuleRegistry registry = new ModuleRegistry();
        RemoteSocketHandler handler = new RemoteSocketHandler(registry, configStore, lockoutTracker, promptService, pendingApprovalStore);

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
}
