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

class MediaModuleTest {
    private FakeInputAdapter inputAdapter;
    private MediaModule mediaModule;
    private Session session;
    private ObjectMapper mapper;

    @BeforeEach
    void setUp() {
        inputAdapter = new FakeInputAdapter();
        mediaModule = new MediaModule(inputAdapter);
        WebSocketSession wsSession = mock(WebSocketSession.class);
        Mockito.when(wsSession.getId()).thenReturn("test-session");
        session = new Session(wsSession);
        mapper = new ObjectMapper();
    }

    @Test
    void testValidMediaAction() {
        ObjectNode data = mapper.createObjectNode();
        data.put("key", "PLAY_PAUSE");
        mediaModule.onMessage(session, "action", data);

        assertEquals(1, inputAdapter.calls.size());
        assertEquals("mediaKey(PLAY_PAUSE)", inputAdapter.calls.get(0));
    }

    @Test
    void testInvalidMediaAction() {
        ObjectNode data = mapper.createObjectNode();
        data.put("key", "INVALID_KEY");
        mediaModule.onMessage(session, "action", data);

        assertEquals(0, inputAdapter.calls.size());
    }
}
