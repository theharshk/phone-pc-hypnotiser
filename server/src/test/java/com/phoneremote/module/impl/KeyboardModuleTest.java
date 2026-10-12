package com.phoneremote.module.impl;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.phoneremote.adapter.fake.FakeInputAdapter;
import com.phoneremote.ws.Session;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.web.socket.WebSocketSession;

import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;

class KeyboardModuleTest {
    private FakeInputAdapter inputAdapter;
    private KeyboardModule keyboardModule;
    private Session session;
    private ObjectMapper mapper;

    @BeforeEach
    void setUp() {
        inputAdapter = new FakeInputAdapter();
        keyboardModule = new KeyboardModule(inputAdapter);
        WebSocketSession wsSession = mock(WebSocketSession.class);
        Mockito.when(wsSession.getId()).thenReturn("test-session");
        Mockito.when(wsSession.isOpen()).thenReturn(true);
        session = new Session(wsSession);
        mapper = new ObjectMapper();
    }

    @Test
    void testTypeText() {
        ObjectNode data = mapper.createObjectNode();
        data.put("text", "hello");
        keyboardModule.onMessage(session, "text", data);

        assertEquals(1, inputAdapter.calls.size());
        assertEquals("typeText(hello)", inputAdapter.calls.get(0));
    }

    @Test
    void testLongTextAccepted() {
        ObjectNode data = mapper.createObjectNode();
        String longText = "a".repeat(250);
        data.put("text", longText);
        keyboardModule.onMessage(session, "text", data);

        assertEquals(1, inputAdapter.calls.size());
        assertEquals("typeText(" + longText + ")", inputAdapter.calls.get(0));
    }

    @Test
    void testNewlinesEmitEnter() {
        ObjectNode data = mapper.createObjectNode();
        data.put("text", "hello\nworld");
        keyboardModule.onMessage(session, "text", data);

        assertEquals(4, inputAdapter.calls.size());
        assertEquals("typeText(hello)", inputAdapter.calls.get(0));
        assertEquals("keyDown(13)", inputAdapter.calls.get(1));
        assertEquals("keyUp(13)", inputAdapter.calls.get(2));
        assertEquals("typeText(world)", inputAdapter.calls.get(3));
    }

    @Test
    void testKeyComboPressReleaseOrder() {
        ObjectNode data = mapper.createObjectNode();
        data.put("code", "Enter");
        data.put("ctrl", true);
        data.put("shift", true);
        data.put("action", "press");

        keyboardModule.onMessage(session, "key", data);

        assertEquals(6, inputAdapter.calls.size());
        assertEquals("keyDown(17)", inputAdapter.calls.get(0));
        assertEquals("keyDown(16)", inputAdapter.calls.get(1));
        assertEquals("keyDown(13)", inputAdapter.calls.get(2));
        assertEquals("keyUp(13)", inputAdapter.calls.get(3));
        assertEquals("keyUp(16)", inputAdapter.calls.get(4));
        assertEquals("keyUp(17)", inputAdapter.calls.get(5));
    }

    @Test
    void testModifierReleaseOnClose() {
        ObjectNode data = mapper.createObjectNode();
        data.put("code", "Enter");
        data.put("action", "down");
        keyboardModule.onMessage(session, "key", data);

        assertEquals(1, inputAdapter.calls.size());
        assertEquals("keyDown(13)", inputAdapter.calls.get(0));

        keyboardModule.onClose(session);
        assertEquals(2, inputAdapter.calls.size());
        assertEquals("keyUp(13)", inputAdapter.calls.get(1));
    }

    @Test
    void testAlphanumericKeyWithWinModifier() {
        ObjectNode data = mapper.createObjectNode();
        data.put("code", "r");
        data.put("win", true);
        data.put("action", "press");
        keyboardModule.onMessage(session, "key", data);

        assertEquals(4, inputAdapter.calls.size());
        assertEquals("keyDown(91)", inputAdapter.calls.get(0)); // VK_LWIN = 0x5B = 91
        assertEquals("keyDown(82)", inputAdapter.calls.get(1)); // 'R' = 0x52 = 82
        assertEquals("keyUp(82)", inputAdapter.calls.get(2));
        assertEquals("keyUp(91)", inputAdapter.calls.get(3));
    }

    @Test
    void testStreamTextConsecutiveNewlines() throws Exception {
        ObjectNode data = mapper.createObjectNode();
        data.put("text", "Line 1\n\nLine 2");
        keyboardModule.onMessage(session, "stream_text", data);
        keyboardModule.awaitCurrentStream(5, TimeUnit.SECONDS);

        long keyDownEnter = inputAdapter.calls.stream().filter(c -> c.equals("keyDown(13)")).count();
        long keyUpEnter = inputAdapter.calls.stream().filter(c -> c.equals("keyUp(13)")).count();

        assertEquals(2, keyDownEnter);
        assertEquals(2, keyUpEnter);
        assertTrue(inputAdapter.calls.contains("typeText(L)"));
        assertTrue(inputAdapter.calls.contains("typeText(1)"));
        assertTrue(inputAdapter.calls.contains("typeText(2)"));
    }

    @Test
    void testStreamTextTabs() throws Exception {
        ObjectNode data = mapper.createObjectNode();
        data.put("text", "A\tB");
        keyboardModule.onMessage(session, "stream_text", data);
        keyboardModule.awaitCurrentStream(5, TimeUnit.SECONDS);

        assertEquals(4, inputAdapter.calls.size());
        assertEquals("typeText(A)", inputAdapter.calls.get(0));
        assertEquals("keyDown(9)", inputAdapter.calls.get(1));
        assertEquals("keyUp(9)", inputAdapter.calls.get(2));
        assertEquals("typeText(B)", inputAdapter.calls.get(3));
    }

    @Test
    void testStreamTextLongParagraph() throws Exception {
        ObjectNode data = mapper.createObjectNode();
        String paragraph = "The quick brown fox jumps over the lazy dog.\nSecond paragraph with multiple words!";
        data.put("text", paragraph);
        keyboardModule.onMessage(session, "stream_text", data);
        keyboardModule.awaitCurrentStream(5, TimeUnit.SECONDS);

        long keyDownEnter = inputAdapter.calls.stream().filter(c -> c.equals("keyDown(13)")).count();
        assertEquals(1, keyDownEnter);
        assertTrue(inputAdapter.calls.size() > 50);
        assertTrue(inputAdapter.calls.contains("typeText(T)"));
        assertTrue(inputAdapter.calls.contains("typeText(!)"));
    }

    @Test
    void testStreamTextCancellation() throws Exception {
        ObjectNode data = mapper.createObjectNode();
        data.put("text", "x".repeat(300));
        keyboardModule.onMessage(session, "stream_text", data);
        Thread.sleep(20);
        keyboardModule.onMessage(session, "cancel_stream", mapper.createObjectNode());
        keyboardModule.awaitCurrentStream(5, TimeUnit.SECONDS);

        assertTrue(inputAdapter.calls.size() < 300, "Calls count was " + inputAdapter.calls.size());
    }

    @Test
    void testStreamTextCustomDelayMs() throws Exception {
        ObjectNode data = mapper.createObjectNode();
        data.put("text", "ab");
        data.put("delayMs", 20);
        keyboardModule.onMessage(session, "stream_text", data);
        keyboardModule.awaitCurrentStream(5, TimeUnit.SECONDS);

        assertEquals(2, inputAdapter.calls.size());
        assertEquals("typeText(a)", inputAdapter.calls.get(0));
        assertEquals("typeText(b)", inputAdapter.calls.get(1));
    }

    @Test
    void testStreamTextDelayClamping() throws Exception {
        ObjectNode data = mapper.createObjectNode();
        data.put("text", "ok");
        data.put("delayMs", -50); // Clamped to 1 ms
        keyboardModule.onMessage(session, "stream_text", data);
        keyboardModule.awaitCurrentStream(5, TimeUnit.SECONDS);

        assertEquals(2, inputAdapter.calls.size());
        assertEquals("typeText(o)", inputAdapter.calls.get(0));
        assertEquals("typeText(k)", inputAdapter.calls.get(1));
    }
}
