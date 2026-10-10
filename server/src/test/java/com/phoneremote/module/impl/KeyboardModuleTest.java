package com.phoneremote.module.impl;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.phoneremote.adapter.fake.FakeInputAdapter;
import com.phoneremote.ws.Session;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.web.socket.WebSocketSession;

import static org.junit.jupiter.api.Assertions.assertEquals;
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
    void testTextLengthLimit() {
        ObjectNode data = mapper.createObjectNode();
        String tooLong = "a".repeat(101);
        data.put("text", tooLong);
        keyboardModule.onMessage(session, "text", data);

        assertEquals(0, inputAdapter.calls.size());
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
}
