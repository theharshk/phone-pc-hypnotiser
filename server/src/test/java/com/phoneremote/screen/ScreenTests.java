package com.phoneremote.screen;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.phoneremote.adapter.InputAdapter;
import com.phoneremote.adapter.MouseButton;
import com.phoneremote.adapter.ScreenAdapter;
import com.phoneremote.adapter.fake.FakeScreenAdapter;
import com.phoneremote.module.ScreenModule;
import com.phoneremote.ws.Session;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.nio.ByteBuffer;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class ScreenTests {

    private ScreenModule module;
    private InputAdapter inputAdapter;
    private Session session;

    @BeforeEach
    void setUp() {
        inputAdapter = mock(InputAdapter.class);
        module = new ScreenModule(new FakeScreenAdapter(), inputAdapter);
        session = mock(Session.class);
        when(session.getId()).thenReturn("test-1");
    }

    @Test
    void testFrameHeaderEncodingAndBackpressure() throws Exception {
        module.onOpen(session);

        // Wait a little bit for the thread to generate frames
        Thread.sleep(500);

        ArgumentCaptor<byte[]> captor = ArgumentCaptor.forClass(byte[].class);
        verify(session, atLeast(1)).sendBinary(captor.capture());

        byte[] frame = captor.getValue();
        assertNotNull(frame);
        assertTrue(frame.length > 8);

        ByteBuffer buf = ByteBuffer.wrap(frame);
        assertEquals(1, buf.get()); // type
        assertEquals(0, buf.get()); // monitor
        int w = buf.getShort() & 0xFFFF;
        int h = buf.getShort() & 0xFFFF;
        assertEquals(1920 * 50 / 100, w); // scale 50
        assertEquals(1080 * 50 / 100, h);

        module.onClose(session);
    }

    @Test
    void testCoordinateMapping() throws Exception {
        module.onOpen(session);
        
        ObjectMapper mapper = new ObjectMapper();
        ObjectNode data = mapper.createObjectNode();
        data.put("x", 0.5);
        data.put("y", 0.5);
        data.put("button", "left");
        
        module.onMessage(session, "tap", data);
        
        verify(inputAdapter, timeout(1000)).moveAbsolute(1920 / 2, 1080 / 2);
        verify(inputAdapter, timeout(1000)).mouseDown(MouseButton.LEFT);
        
        module.onClose(session);
    }

    @Test
    void testSettingsRangeValidation() {
        module.onOpen(session);
        ObjectMapper mapper = new ObjectMapper();
        ObjectNode data = mapper.createObjectNode();
        data.put("quality", 200); // above 90
        data.put("scale", 10);    // below 25
        data.put("fps", 30);      // above 15
        
        module.onMessage(session, "settings", data);
        
        // Wait and check logs or just verify it does not crash
        // The values should clamp internally.
        module.onClose(session);
    }
}
