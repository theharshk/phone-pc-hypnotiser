package com.phoneremote.module.impl;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.phoneremote.adapter.fake.FakeInputAdapter;
import com.phoneremote.ws.Session;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.web.socket.WebSocketSession;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.mock;

class TouchpadModuleTest {

    private FakeInputAdapter inputAdapter;
    private TouchpadModule touchpadModule;
    private Session session;
    private ObjectMapper mapper;

    @BeforeEach
    void setUp() {
        inputAdapter = new FakeInputAdapter();
        touchpadModule = new TouchpadModule(inputAdapter);
        WebSocketSession wsSession = mock(WebSocketSession.class);
        Mockito.when(wsSession.getId()).thenReturn("test-session");
        session = new Session(wsSession);
        mapper = new ObjectMapper();
    }

    @Test
    void testMove() {
        ObjectNode data = mapper.createObjectNode();
        data.put("dx", 10);
        data.put("dy", -5);
        touchpadModule.onMessage(session, "move", data);

        assertEquals(1, inputAdapter.calls.size());
        assertEquals("moveRelative(14,-7)", inputAdapter.calls.get(0));
    }

    @Test
    void testClick() {
        touchpadModule.onMessage(session, "click", mapper.createObjectNode());
        assertEquals(2, inputAdapter.calls.size());
        assertEquals("mouseDown(LEFT)", inputAdapter.calls.get(0));
        assertEquals("mouseUp(LEFT)", inputAdapter.calls.get(1));
    }

    @Test
    void testScroll() {
        ObjectNode data = mapper.createObjectNode();
        data.put("amount", 3);
        touchpadModule.onMessage(session, "scroll", data);
        assertEquals(1, inputAdapter.calls.size());
        assertEquals("scroll(3)", inputAdapter.calls.get(0));
    }

    @Test
    void testOversizedMoveIsIgnored() {
        ObjectNode data = mapper.createObjectNode();
        data.put("dx", 5000); // Beyond limit
        data.put("dy", 10);
        touchpadModule.onMessage(session, "move", data);
        assertEquals(0, inputAdapter.calls.size());
    }

    @Test
    void testDragAndReleaseOnClose() {
        touchpadModule.onMessage(session, "down", mapper.createObjectNode());
        assertEquals(1, inputAdapter.calls.size());
        assertEquals("mouseDown(LEFT)", inputAdapter.calls.get(0));
        assertTrue((Boolean) session.getAttribute("touchpad.leftDown"));

        // Simulate disconnect / close
        touchpadModule.onClose(session);
        assertEquals(2, inputAdapter.calls.size());
        assertEquals("mouseUp(LEFT)", inputAdapter.calls.get(1));
        assertNull(session.getAttribute("touchpad.leftDown"));
    }
}
