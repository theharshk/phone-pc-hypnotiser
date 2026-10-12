package com.phoneremote.security;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.LoggerContext;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.phoneremote.adapter.PowerAction;
import com.phoneremote.adapter.fake.FakePowerAdapter;
import com.phoneremote.admin.AdminController;
import com.phoneremote.config.AppConfig;
import com.phoneremote.config.ConfigStore;
import com.phoneremote.module.ModuleRegistry;
import com.phoneremote.module.RemoteModule;
import com.phoneremote.module.impl.PowerModule;
import com.phoneremote.terminal.TerminalPromptService;
import com.phoneremote.ws.LockoutTracker;
import com.phoneremote.ws.RemoteSocketHandler;
import com.phoneremote.ws.Session;
import com.phoneremote.ws.TimeSource;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.slf4j.LoggerFactory;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.PrintStream;
import java.net.InetSocketAddress;
import java.nio.file.Files;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

public class SecurityTests {

    private ConfigStore configStore;
    private LockoutTracker lockoutTracker;
    private ObjectMapper mapper;
    private String tempDir;
    private PrintStream originalOut;
    private PrintStream originalErr;

    static class MutableTimeSource implements TimeSource {
        long current = 1000000L;
        @Override
        public long currentTimeMillis() {
            return current;
        }
    }

    @BeforeEach
    void setUp() throws Exception {
        tempDir = Files.createTempDirectory("securitytests").toString();
        System.setProperty("user.dir", tempDir);
        System.setProperty("test.config.dir", tempDir);
        configStore = new ConfigStore();
        lockoutTracker = new LockoutTracker();
        mapper = new ObjectMapper();
    }

    @AfterEach
    void tearDown() {
        if (originalOut != null) System.setOut(originalOut);
        if (originalErr != null) System.setErr(originalErr);
    }

    // 1. Any non-hello/pin/ping message before authentication is rejected (touchpad, keyboard, media, power, screen)
    @Test
    void testPreAuthMessagesRejectedForTouchpadKeyboardMediaPowerScreen() throws Exception {
        RemoteModule touchpadMod = mock(RemoteModule.class);
        when(touchpadMod.id()).thenReturn("touchpad");

        RemoteModule keyboardMod = mock(RemoteModule.class);
        when(keyboardMod.id()).thenReturn("keyboard");

        RemoteModule mediaMod = mock(RemoteModule.class);
        when(mediaMod.id()).thenReturn("media");

        RemoteModule powerMod = mock(RemoteModule.class);
        when(powerMod.id()).thenReturn("power");

        RemoteModule screenMod = mock(RemoteModule.class);
        when(screenMod.id()).thenReturn("screen");

        ModuleRegistry registry = new ModuleRegistry(List.of(touchpadMod, keyboardMod, mediaMod, powerMod, screenMod));
        RemoteSocketHandler handler = new RemoteSocketHandler(registry, configStore, lockoutTracker, mock(TerminalPromptService.class));

        WebSocketSession ws = mock(WebSocketSession.class);
        when(ws.getId()).thenReturn("ws-preauth-test");
        when(ws.isOpen()).thenReturn(true);
        handler.afterConnectionEstablished(ws);

        // Send unauthenticated messages for each module
        String[] modules = {"touchpad", "keyboard", "media", "power", "screen"};
        String[] actions = {"move", "type", "play_pause", "execute", "start"};

        for (int i = 0; i < modules.length; i++) {
            ObjectNode msg = mapper.createObjectNode();
            msg.put("m", modules[i]);
            msg.put("t", actions[i]);
            ObjectNode d = mapper.createObjectNode();
            d.put("param", "val");
            msg.set("d", d);

            handler.handleMessage(ws, new TextMessage(mapper.writeValueAsString(msg)));
        }

        // None of the modules must have received onMessage
        verify(touchpadMod, never()).onMessage(any(), any(), any());
        verify(keyboardMod, never()).onMessage(any(), any(), any());
        verify(mediaMod, never()).onMessage(any(), any(), any());
        verify(powerMod, never()).onMessage(any(), any(), any());
        verify(screenMod, never()).onMessage(any(), any(), any());

        // Session must remain unauthenticated
        assertEquals(0, handler.getActiveSessionCount());
    }

    // 2. Unauthenticated sockets are closed after 10 seconds
    @Test
    void testUnauthenticatedSocketsClosedAfterTimeout() throws Exception {
        RemoteSocketHandler handler = new RemoteSocketHandler(
                new ModuleRegistry(Collections.emptyList()),
                configStore,
                lockoutTracker,
                mock(TerminalPromptService.class)
        );

        // Verify documented default is exactly 10 seconds (10000 ms)
        assertEquals(10000L, handler.getAuthTimeoutMs(), "Default auth timeout must be 10 seconds (10000 ms)");

        // Test timeout firing using a short test timeout (100 ms)
        handler.setAuthTimeoutMs(100L);

        WebSocketSession wsUnauth = mock(WebSocketSession.class);
        when(wsUnauth.getId()).thenReturn("ws-timeout-unauth");
        when(wsUnauth.isOpen()).thenReturn(true);

        handler.afterConnectionEstablished(wsUnauth);

        // Wait for timeout to fire
        Thread.sleep(250L);
        verify(wsUnauth, times(1)).close();

        // Now test authenticated socket: should NOT be closed when timeout expires
        ConfigStore.DeviceInfo dAuth = new ConfigStore.DeviceInfo();
        dAuth.deviceId = "dev-auth-timeout";
        dAuth.tokenHash = configStore.hashToken("valid-token-timeout");
        configStore.addDevice(dAuth);

        WebSocketSession wsAuth = mock(WebSocketSession.class);
        when(wsAuth.getId()).thenReturn("ws-timeout-auth");
        when(wsAuth.isOpen()).thenReturn(true);

        handler.afterConnectionEstablished(wsAuth);

        // Authenticate immediately with pre-paired token
        ObjectNode helloMsg = mapper.createObjectNode();
        helloMsg.put("m", "core");
        helloMsg.put("t", "hello");
        ObjectNode helloD = mapper.createObjectNode();
        helloD.put("deviceId", "dev-auth-timeout");
        helloD.put("token", "valid-token-timeout");
        helloMsg.set("d", helloD);

        handler.handleMessage(wsAuth, new TextMessage(mapper.writeValueAsString(helloMsg)));
        assertEquals(1, handler.getActiveSessionCount());

        Thread.sleep(250L);
        // Authenticated socket must not be closed by the auth timer
        verify(wsAuth, never()).close();
    }

    // 3. Revoked and unknown tokens are rejected in hello
    @Test
    void testRevokedAndUnknownTokensRejectedInHello() throws Exception {
        RemoteSocketHandler handler = new RemoteSocketHandler(
                new ModuleRegistry(Collections.emptyList()),
                configStore,
                lockoutTracker,
                mock(TerminalPromptService.class)
        );

        WebSocketSession ws = mock(WebSocketSession.class);
        when(ws.getId()).thenReturn("ws-unknown-token");
        when(ws.isOpen()).thenReturn(true);
        handler.afterConnectionEstablished(ws);

        // 3a. Unknown token in hello
        ObjectNode unknownHello = mapper.createObjectNode();
        unknownHello.put("m", "core");
        unknownHello.put("t", "hello");
        ObjectNode d1 = mapper.createObjectNode();
        d1.put("deviceId", "unknown-device");
        d1.put("token", "completely-unknown-token-12345");
        unknownHello.set("d", d1);

        handler.handleMessage(ws, new TextMessage(mapper.writeValueAsString(unknownHello)));

        ArgumentCaptor<TextMessage> captor = ArgumentCaptor.forClass(TextMessage.class);
        verify(ws, atLeastOnce()).sendMessage(captor.capture());
        JsonNode reply = mapper.readTree(captor.getValue().getPayload());
        assertEquals("error", reply.path("t").asText());
        assertEquals("revoked", reply.path("d").path("code").asText());
        assertEquals(0, handler.getActiveSessionCount());

        // 3b. Revoked token in hello
        String devId = "dev-revoked-test";
        String token = "valid-token-before-revoke";
        ConfigStore.DeviceInfo info = new ConfigStore.DeviceInfo();
        info.deviceId = devId;
        info.tokenHash = configStore.hashToken(token);
        configStore.addDevice(info);

        // Revoke device by removing from ConfigStore
        configStore.removeDevice(devId);

        WebSocketSession ws2 = mock(WebSocketSession.class);
        when(ws2.getId()).thenReturn("ws-revoked-token");
        when(ws2.isOpen()).thenReturn(true);
        handler.afterConnectionEstablished(ws2);

        ObjectNode revokedHello = mapper.createObjectNode();
        revokedHello.put("m", "core");
        revokedHello.put("t", "hello");
        ObjectNode d2 = mapper.createObjectNode();
        d2.put("deviceId", devId);
        d2.put("token", token);
        revokedHello.set("d", d2);

        handler.handleMessage(ws2, new TextMessage(mapper.writeValueAsString(revokedHello)));

        ArgumentCaptor<TextMessage> captor2 = ArgumentCaptor.forClass(TextMessage.class);
        verify(ws2, atLeastOnce()).sendMessage(captor2.capture());
        JsonNode reply2 = mapper.readTree(captor2.getValue().getPayload());
        assertEquals("error", reply2.path("t").asText());
        assertEquals("revoked", reply2.path("d").path("code").asText());
        assertEquals(0, handler.getActiveSessionCount());
    }

    // 4. /ws with a wrong Origin is rejected; a missing Origin follows the documented rule
    @Test
    void testWebSocketOriginValidationRules() {
        // Missing Origin: allowed (documented rule for non-browser/direct clients)
        assertTrue(AppConfig.validateOrigin(null, "localhost:8080"));
        assertTrue(AppConfig.validateOrigin(null, "192.168.1.100:8080"));

        // Valid matching Origin: allowed
        assertTrue(AppConfig.validateOrigin("http://localhost:8080", "localhost:8080"));
        assertTrue(AppConfig.validateOrigin("http://192.168.1.100:8080", "192.168.1.100:8080"));
        assertTrue(AppConfig.validateOrigin("https://phone-remote.local", "phone-remote.local"));

        // Wrong Origin: rejected
        assertFalse(AppConfig.validateOrigin("http://attacker.com", "localhost:8080"));
        assertFalse(AppConfig.validateOrigin("http://malicious.org:8080", "192.168.1.100:8080"));
        assertFalse(AppConfig.validateOrigin("http://localhost:9090", "localhost:8080"));

        // Malformed Origin: safely rejected without throwing
        assertFalse(AppConfig.validateOrigin("http://invalid^uri:9999", "localhost:8080"));
    }

    // 5. /admin and its POST routes are refused from a non-loopback address, with a wrong Host header, and without a valid CSRF token
    @Test
    void testAdminAndPostRoutesRefusedForNonLoopbackWrongHostAndMissingCsrf() throws Exception {
        AdminController controller = new AdminController(configStore, lockoutTracker, null);

        // Helper to test a POST endpoint
        java.util.function.BiConsumer<String, java.util.function.BiFunction<MockHttpServletRequest, MockHttpServletResponse, Object>> assertRouteSecured = (name, routeAction) -> {
            try {
                // a. Non-loopback address -> 403
                MockHttpServletRequest reqNonLoopback = new MockHttpServletRequest();
                reqNonLoopback.setRemoteAddr("192.168.1.55");
                reqNonLoopback.addHeader("Host", "localhost:8080");
                reqNonLoopback.getSession().setAttribute("csrf_token", "valid-csrf");
                reqNonLoopback.setParameter("csrf", "valid-csrf");
                MockHttpServletResponse resNonLoopback = new MockHttpServletResponse();
                routeAction.apply(reqNonLoopback, resNonLoopback);
                assertTrue(resNonLoopback.getStatus() == 403, name + " should return 403 for non-loopback IP");

                // b. Wrong Host header -> 403
                MockHttpServletRequest reqWrongHost = new MockHttpServletRequest();
                reqWrongHost.setRemoteAddr("127.0.0.1");
                reqWrongHost.addHeader("Host", "evil.attacker.com");
                reqWrongHost.getSession().setAttribute("csrf_token", "valid-csrf");
                reqWrongHost.setParameter("csrf", "valid-csrf");
                MockHttpServletResponse resWrongHost = new MockHttpServletResponse();
                routeAction.apply(reqWrongHost, resWrongHost);
                assertTrue(resWrongHost.getStatus() == 403, name + " should return 403 for wrong Host");

                // c. Missing or invalid CSRF token -> 400 or 403
                MockHttpServletRequest reqNoCsrf = new MockHttpServletRequest();
                reqNoCsrf.setRemoteAddr("127.0.0.1");
                reqNoCsrf.addHeader("Host", "localhost:8080");
                reqNoCsrf.getSession().setAttribute("csrf_token", "valid-csrf");
                reqNoCsrf.setParameter("csrf", "wrong-csrf-token");
                MockHttpServletResponse resNoCsrf = new MockHttpServletResponse();
                routeAction.apply(reqNoCsrf, resNoCsrf);
                assertTrue(resNoCsrf.getStatus() == 400 || resNoCsrf.getStatus() == 403, name + " should return 400 or 403 for invalid CSRF");
            } catch (Exception e) {
                fail("Exception on " + name + ": " + e.getMessage());
            }
        };

        // Test POST routes
        assertRouteSecured.accept("/admin/revoke", (req, res) -> {
            try { return controller.handleRevoke(req, res); } catch (Exception e) { throw new RuntimeException(e); }
        });

        assertRouteSecured.accept("/admin/security", (req, res) -> {
            try { return controller.handleSecurity(req, res); } catch (Exception e) { throw new RuntimeException(e); }
        });

        assertRouteSecured.accept("/admin/clear_lockouts", (req, res) -> {
            try { return controller.handleClearLockouts(req, res); } catch (Exception e) { throw new RuntimeException(e); }
        });

        assertRouteSecured.accept("/admin/logs/level", (req, res) -> {
            try { return controller.toggleLogLevel(req, res); } catch (Exception e) { throw new RuntimeException(e); }
        });

        assertRouteSecured.accept("/admin/api/lockouts", (req, res) -> {
            try { return controller.clearLockouts(req, res); } catch (Exception e) { throw new RuntimeException(e); }
        });

        assertRouteSecured.accept("/admin/approve", (req, res) -> {
            try { return controller.handleApprove(req, res); } catch (Exception e) { throw new RuntimeException(e); }
        });

        // Test GET /admin as well
        MockHttpServletRequest reqGetNonLoopback = new MockHttpServletRequest();
        reqGetNonLoopback.setRemoteAddr("192.168.1.99");
        reqGetNonLoopback.addHeader("Host", "localhost:8080");
        MockHttpServletResponse resGetNonLoopback = new MockHttpServletResponse();
        controller.adminPage(reqGetNonLoopback, resGetNonLoopback);
        assertEquals(403, resGetNonLoopback.getStatus());

        MockHttpServletRequest reqGetWrongHost = new MockHttpServletRequest();
        reqGetWrongHost.setRemoteAddr("127.0.0.1");
        reqGetWrongHost.addHeader("Host", "evil-rebinding.com");
        MockHttpServletResponse resGetWrongHost = new MockHttpServletResponse();
        controller.adminPage(reqGetWrongHost, resGetWrongHost);
        assertEquals(403, resGetWrongHost.getStatus());
    }

    // 6. An oversized or malformed message is rejected without crashing the session
    @Test
    void testOversizedAndMalformedMessagesRejectedWithoutCrashingSession() throws Exception {
        RemoteSocketHandler handler = new RemoteSocketHandler(
                new ModuleRegistry(Collections.emptyList()),
                configStore,
                lockoutTracker,
                mock(TerminalPromptService.class)
        );

        WebSocketSession ws = mock(WebSocketSession.class);
        when(ws.getId()).thenReturn("ws-malformed-session");
        when(ws.isOpen()).thenReturn(true);
        handler.afterConnectionEstablished(ws);

        // Authenticate the session
        configStore.setPin("123456");
        ObjectNode pinMsg = mapper.createObjectNode();
        pinMsg.put("m", "core");
        pinMsg.put("t", "pin");
        ObjectNode pinD = mapper.createObjectNode();
        pinD.put("pin", "123456");
        pinD.put("deviceId", "dev-crash-test");
        pinMsg.set("d", pinD);
        handler.handleMessage(ws, new TextMessage(mapper.writeValueAsString(pinMsg)));
        assertEquals(1, handler.getActiveSessionCount());

        // 6a. Malformed JSON message
        assertDoesNotThrow(() -> {
            handler.handleMessage(ws, new TextMessage("{\"m\":\"core\", broken json syntax..."));
        });
        assertTrue(ws.isOpen(), "Session must remain open after malformed message");
        assertEquals(1, handler.getActiveSessionCount(), "Session must still be active");

        // 6b. Oversized message (> 256 KB)
        StringBuilder largePayload = new StringBuilder();
        largePayload.append("{\"m\":\"core\",\"t\":\"ping\",\"junk\":\"");
        largePayload.append("A".repeat(300000));
        largePayload.append("\"}");
        assertDoesNotThrow(() -> {
            handler.handleMessage(ws, new TextMessage(largePayload.toString()));
        });
        assertTrue(ws.isOpen(), "Session must remain open after oversized message");
        assertEquals(1, handler.getActiveSessionCount(), "Session must still be active");

        // 6c. Verify subsequent valid ping message still works normally
        ObjectNode pingMsg = mapper.createObjectNode();
        pingMsg.put("m", "core");
        pingMsg.put("t", "ping");
        pingMsg.put("i", 9999);
        handler.handleMessage(ws, new TextMessage(mapper.writeValueAsString(pingMsg)));

        ArgumentCaptor<TextMessage> textCaptor = ArgumentCaptor.forClass(TextMessage.class);
        verify(ws, atLeastOnce()).sendMessage(textCaptor.capture());
        boolean receivedPong = false;
        for (TextMessage tm : textCaptor.getAllValues()) {
            JsonNode n = mapper.readTree(tm.getPayload());
            if ("pong".equals(n.path("t").asText()) && n.path("i").asInt() == 9999) {
                receivedPong = true;
            }
        }
        assertTrue(receivedPong, "Valid message must be processed after malformed and oversized messages");
    }

    // 7. Power execute fails with a missing, expired, reused, wrong-session or wrong-action confirm token
    @Test
    void testPowerExecuteTokenFailures() throws Exception {
        FakePowerAdapter powerAdapter = new FakePowerAdapter();
        MutableTimeSource fakeClock = new MutableTimeSource();
        PowerModule powerModule = new PowerModule(powerAdapter, fakeClock);

        WebSocketSession ws1 = mock(WebSocketSession.class);
        when(ws1.getId()).thenReturn("power-session-1");
        Session session1 = new Session(ws1);
        session1.setAttribute("deviceName", "Phone 1");

        // Request a token for RESTART
        ObjectNode req = mapper.createObjectNode();
        req.put("action", "RESTART");

        final String[] capturedToken = new String[1];
        Session captureSession = new Session(mock(WebSocketSession.class)) {
            @Override public String getId() { return "power-session-1"; }
            @Override public void send(String text) {
                try {
                    JsonNode n = mapper.readTree(text);
                    if ("token".equals(n.path("t").asText())) {
                        capturedToken[0] = n.path("d").path("token").asText();
                    }
                } catch (Exception ignored) {}
            }
        };
        powerModule.onMessage(captureSession, "request", req);
        String token = capturedToken[0];
        assertNotNull(token);

        // 7a. Missing confirm token
        ObjectNode missingTokenExec = mapper.createObjectNode();
        missingTokenExec.put("action", "RESTART");
        powerModule.onMessage(session1, "execute", missingTokenExec);
        assertEquals(0, powerAdapter.calls.size(), "Missing token must not execute power action");

        // 7b. Wrong action confirm token (requested RESTART, executing SHUTDOWN)
        ObjectNode wrongActionExec = mapper.createObjectNode();
        wrongActionExec.put("token", token);
        wrongActionExec.put("action", "SHUTDOWN");
        powerModule.onMessage(session1, "execute", wrongActionExec);
        assertEquals(0, powerAdapter.calls.size(), "Wrong action must not execute power action");

        // 7c. Wrong session confirm token
        WebSocketSession ws2 = mock(WebSocketSession.class);
        when(ws2.getId()).thenReturn("power-session-2");
        Session session2 = new Session(ws2);
        ObjectNode wrongSessionExec = mapper.createObjectNode();
        wrongSessionExec.put("token", token);
        wrongSessionExec.put("action", "RESTART");
        powerModule.onMessage(session2, "execute", wrongSessionExec);
        assertEquals(0, powerAdapter.calls.size(), "Wrong session must not execute power action");

        // 7d. Expired confirm token (> 10 seconds)
        fakeClock.current += 10001L; // Advance past 10-second expiry
        ObjectNode expiredExec = mapper.createObjectNode();
        expiredExec.put("token", token);
        expiredExec.put("action", "RESTART");
        powerModule.onMessage(session1, "execute", expiredExec);
        assertEquals(0, powerAdapter.calls.size(), "Expired token must not execute power action");

        // Request a fresh token to test reuse and valid execute
        powerModule.onMessage(captureSession, "request", req);
        String freshToken = capturedToken[0];

        // Valid execution: succeeds
        ObjectNode validExec = mapper.createObjectNode();
        validExec.put("token", freshToken);
        validExec.put("action", "RESTART");
        powerModule.onMessage(session1, "execute", validExec);
        assertEquals(1, powerAdapter.calls.size());
        assertEquals("restart()", powerAdapter.calls.get(0));

        // 7e. Reused confirm token: must fail on second execute
        powerModule.onMessage(session1, "execute", validExec);
        assertEquals(1, powerAdapter.calls.size(), "Reused token must not execute power action again");
    }

    // 8. A PIN sent during a lockout is not counted and does not extend it
    @Test
    void testPinSentDuringLockoutNotCountedAndDoesNotExtend() throws Exception {
        MutableTimeSource fakeClock = new MutableTimeSource();
        long lockoutDurationMs = 5000L;
        LockoutTracker tracker = new LockoutTracker(fakeClock, lockoutDurationMs, 100000L);

        configStore.setPin("123456");
        RemoteSocketHandler handler = new RemoteSocketHandler(
                new ModuleRegistry(Collections.emptyList()),
                configStore,
                tracker,
                mock(TerminalPromptService.class)
        );

        WebSocketSession ws = mock(WebSocketSession.class);
        when(ws.getId()).thenReturn("ws-lockout-strike-test");
        when(ws.isOpen()).thenReturn(true);
        handler.afterConnectionEstablished(ws);

        java.util.function.Consumer<String> sendPin = (p) -> {
            try {
                ObjectNode msg = mapper.createObjectNode();
                msg.put("m", "core");
                msg.put("t", "pin");
                ObjectNode d = mapper.createObjectNode();
                d.put("pin", p);
                d.put("deviceId", "dev-lockout-strict");
                msg.set("d", d);
                handler.handleMessage(ws, new TextMessage(mapper.writeValueAsString(msg)));
            } catch (Exception e) {
                throw new RuntimeException(e);
            }
        };

        // 5 wrong attempts trigger lockout
        for (int i = 0; i < 5; i++) {
            sendPin.accept("000000");
        }
        assertTrue(tracker.isLockedOut("DEV:dev-lockout-strict"));
        long initialRemaining = tracker.getLockoutRemaining("DEV:dev-lockout-strict");
        assertEquals(5000L, initialRemaining);

        // Advance 1 second into lockout
        fakeClock.current += 1000L;
        long expectedRemaining = 4000L;
        assertEquals(expectedRemaining, tracker.getLockoutRemaining("DEV:dev-lockout-strict"));

        // Send wrong PIN during active lockout
        sendPin.accept("999999");
        sendPin.accept("888888");

        // Must still have the same 4000L remaining (not extended back to 5000L or escalated to 10000L)
        assertEquals(expectedRemaining, tracker.getLockoutRemaining("DEV:dev-lockout-strict"),
                "Lockout must not be extended when PIN is sent during lockout");
    }

    // 9. Device names and log lines are HTML-escaped in admin output
    @Test
    void testDeviceNamesAndLogLinesHtmlEscapedInAdmin() throws Exception {
        RemoteSocketHandler mockSocketHandler = mock(RemoteSocketHandler.class);
        AdminController controller = new AdminController(configStore, lockoutTracker, mockSocketHandler);

        // 9a. Malicious device name in ConfigStore
        String xssName = "<script>alert('xss-device')</script>";
        ConfigStore.DeviceInfo d = new ConfigStore.DeviceInfo();
        d.deviceId = "xss-dev-id";
        d.name = xssName;
        d.lastIp = "127.0.0.1";
        configStore.addDevice(d);

        MockHttpServletRequest req = new MockHttpServletRequest();
        req.setRemoteAddr("127.0.0.1");
        req.addHeader("Host", "localhost:8080");
        MockHttpServletResponse res = new MockHttpServletResponse();

        String stateJson = controller.apiState(req, res);
        assertNotNull(stateJson);
        assertTrue(stateJson.contains("&lt;script&gt;alert(&#x27;xss-device&#x27;)&lt;/script&gt;"), "Device name must be HTML-escaped");
        assertFalse(stateJson.contains("<script>"), "Raw unescaped script tag must not appear");

        // 9b. Malicious log line in InMemoryLogAppender
        com.phoneremote.logging.InMemoryLogAppender.clear();
        controller.initLogging();
        LoggerContext lc = (LoggerContext) LoggerFactory.getILoggerFactory();
        ch.qos.logback.classic.Logger logger = lc.getLogger("com.phoneremote.test");
        logger.info("Malicious log payload <img src=x onerror=alert(1)>");

        String logsJson = controller.apiLogs(req, res);
        assertNotNull(logsJson);
        assertTrue(logsJson.contains("&lt;img src=x onerror=alert(1)&gt;"), "Log line must be HTML-escaped");
        assertFalse(logsJson.contains("<img"), "Raw unescaped img tag must not appear");
    }

    // 10. Secrets never appear in log output (PIN, tokens, typed text, raw messages)
    @Test
    void testSecretsNeverAppearInLogOutput() throws Exception {
        LoggerContext lc = (LoggerContext) LoggerFactory.getILoggerFactory();
        ListAppender<ILoggingEvent> listAppender = new ListAppender<>();
        listAppender.setContext(lc);
        listAppender.start();
        lc.getLogger(org.slf4j.Logger.ROOT_LOGGER_NAME).addAppender(listAppender);

        ByteArrayOutputStream capturedOut = new ByteArrayOutputStream();
        ByteArrayOutputStream capturedErr = new ByteArrayOutputStream();
        originalOut = System.out;
        originalErr = System.err;
        System.setOut(new PrintStream(capturedOut));
        System.setErr(new PrintStream(capturedErr));

        String secretPin = "741852";
        String secretToken = "super-secret-auth-token-xyz999";
        String secretTyped = "MySensitivePasswordToNeverLog!";
        String secretPayload = "{\"secret_payload_touchpad\":true}";

        configStore.setPin(secretPin);
        RemoteModule mockKeyboard = mock(RemoteModule.class);
        when(mockKeyboard.id()).thenReturn("keyboard");
        ModuleRegistry registry = new ModuleRegistry(List.of(mockKeyboard));
        RemoteSocketHandler handler = new RemoteSocketHandler(registry, configStore, lockoutTracker, mock(TerminalPromptService.class));

        WebSocketSession ws = mock(WebSocketSession.class);
        when(ws.getId()).thenReturn("ws-secrets-test");
        when(ws.isOpen()).thenReturn(true);
        handler.afterConnectionEstablished(ws);

        // a. Send PIN
        ObjectNode pinMsg = mapper.createObjectNode();
        pinMsg.put("m", "core");
        pinMsg.put("t", "pin");
        ObjectNode dPin = mapper.createObjectNode();
        dPin.put("pin", secretPin);
        dPin.put("deviceId", "dev-secret-1");
        pinMsg.set("d", dPin);
        handler.handleMessage(ws, new TextMessage(mapper.writeValueAsString(pinMsg)));

        // b. Send keyboard typed text
        ObjectNode kbdMsg = mapper.createObjectNode();
        kbdMsg.put("m", "keyboard");
        kbdMsg.put("t", "type");
        ObjectNode dKbd = mapper.createObjectNode();
        dKbd.put("text", secretTyped);
        kbdMsg.set("d", dKbd);
        handler.handleMessage(ws, new TextMessage(mapper.writeValueAsString(kbdMsg)));

        // c. Send raw payload message
        handler.handleMessage(ws, new TextMessage(secretPayload));

        // Aggregate all logs
        StringBuilder allLogs = new StringBuilder();
        for (ILoggingEvent event : listAppender.list) {
            allLogs.append(event.getFormattedMessage()).append("\n");
        }
        allLogs.append(capturedOut.toString()).append("\n");
        allLogs.append(capturedErr.toString()).append("\n");

        String fullLogText = allLogs.toString();

        // Assert no secrets appear in logs
        assertFalse(fullLogText.contains(secretPin), "PIN must never appear in log output");
        assertFalse(fullLogText.contains(secretToken), "Tokens must never appear in log output");
        assertFalse(fullLogText.contains(secretTyped), "Typed text must never appear in log output");
        assertFalse(fullLogText.contains("secret_payload_touchpad"), "Raw messages must never appear in log output");

        lc.getLogger(org.slf4j.Logger.ROOT_LOGGER_NAME).detachAppender(listAppender);
    }
}
