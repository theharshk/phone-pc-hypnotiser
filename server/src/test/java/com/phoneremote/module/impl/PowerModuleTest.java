package com.phoneremote.module.impl;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.phoneremote.adapter.fake.FakePowerAdapter;
import com.phoneremote.ws.Session;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.web.socket.WebSocketSession;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;

class PowerModuleTest {

    private FakePowerAdapter powerAdapter;
    private PowerModule powerModule;
    private Session session;
    private ObjectMapper mapper;

    @BeforeEach
    void setUp() {
        powerAdapter = new FakePowerAdapter();
        powerModule = new PowerModule(powerAdapter);
        WebSocketSession wsSession = mock(WebSocketSession.class);
        Mockito.when(wsSession.getId()).thenReturn("test-session");
        session = new Session(wsSession);
        session.setAttribute("deviceName", "Test Phone");
        mapper = new ObjectMapper();
    }

    private String requestToken(String action) {
        ObjectNode req = mapper.createObjectNode();
        req.put("action", action);
        
        final String[] capturedToken = new String[1];
        Session captureSession = new Session(mock(WebSocketSession.class)) {
            @Override
            public String getId() { return "test-session"; }
            @Override
            public void send(String text) {
                try {
                    JsonNode root = mapper.readTree(text);
                    if ("token".equals(root.path("t").asText())) {
                        capturedToken[0] = root.path("d").path("token").asText();
                    }
                } catch (Exception e) {}
            }
        };
        captureSession.setAttribute("deviceName", "Test Phone");
        
        powerModule.onMessage(captureSession, "request", req);
        return capturedToken[0];
    }

    @Test
    void testValidExecute() {
        String token = requestToken("SHUTDOWN");
        ObjectNode exec = mapper.createObjectNode();
        exec.put("token", token);
        exec.put("action", "SHUTDOWN");
        
        powerModule.onMessage(session, "execute", exec);
        assertEquals(1, powerAdapter.calls.size());
        assertEquals("shutdown()", powerAdapter.calls.get(0));
    }

    @Test
    void testTokenReuseRejected() {
        String token = requestToken("RESTART");
        ObjectNode exec = mapper.createObjectNode();
        exec.put("token", token);
        exec.put("action", "RESTART");
        
        powerModule.onMessage(session, "execute", exec);
        assertEquals(1, powerAdapter.calls.size());
        
        powerModule.onMessage(session, "execute", exec);
        assertEquals(1, powerAdapter.calls.size()); // still 1
    }

    @Test
    void testWrongSessionRejected() {
        String token = requestToken("SLEEP");
        ObjectNode exec = mapper.createObjectNode();
        exec.put("token", token);
        exec.put("action", "SLEEP");
        
        WebSocketSession wsSession2 = mock(WebSocketSession.class);
        Mockito.when(wsSession2.getId()).thenReturn("other-session");
        Session session2 = new Session(wsSession2);
        
        powerModule.onMessage(session2, "execute", exec);
        assertEquals(0, powerAdapter.calls.size());
    }

    @Test
    void testWrongActionRejected() {
        String token = requestToken("LOCK");
        ObjectNode exec = mapper.createObjectNode();
        exec.put("token", token);
        exec.put("action", "SHUTDOWN"); // mismatch
        
        powerModule.onMessage(session, "execute", exec);
        assertEquals(0, powerAdapter.calls.size());
    }

    @Test
    void testInvalidEnumRejected() {
        ObjectNode req = mapper.createObjectNode();
        req.put("action", "INVALID_ACTION");
        powerModule.onMessage(session, "request", req);
        
        // Ensure no exception blows up and no command is run
        assertEquals(0, powerAdapter.calls.size());
    }

    @Test
    void testDelayRangeValidation() {
        String token1 = requestToken("SHUTDOWN");
        ObjectNode sched1 = mapper.createObjectNode();
        sched1.put("token", token1);
        sched1.put("action", "SHUTDOWN");
        sched1.put("seconds", 5); // too low
        powerModule.onMessage(session, "schedule", sched1);
        
        String token2 = requestToken("SHUTDOWN");
        ObjectNode sched2 = mapper.createObjectNode();
        sched2.put("token", token2);
        sched2.put("action", "SHUTDOWN");
        sched2.put("seconds", 5000); // too high
        powerModule.onMessage(session, "schedule", sched2);
        
        assertEquals(0, powerAdapter.calls.size());
        
        String token3 = requestToken("SHUTDOWN");
        ObjectNode sched3 = mapper.createObjectNode();
        sched3.put("token", token3);
        sched3.put("action", "SHUTDOWN");
        sched3.put("seconds", 60); // valid
        powerModule.onMessage(session, "schedule", sched3);
        
        assertEquals(1, powerAdapter.calls.size());
        assertEquals("delayedShutdown(60)", powerAdapter.calls.get(0));
    }
}
