package com.phoneremote.screen;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.phoneremote.adapter.InputAdapter;
import com.phoneremote.adapter.MouseButton;
import com.phoneremote.adapter.fake.FakeScreenAdapter;
import com.phoneremote.module.ScreenModule;
import com.phoneremote.ws.Session;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.nio.ByteBuffer;

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
    void testPipelineAndBackpressure() throws Exception {
        module.onOpen(session);
        Thread.sleep(1000); // let pipeline produce frames

        // Due to backpressure limit of 2, sender thread should only send up to 2 frames without ACKs
        ArgumentCaptor<byte[]> captor = ArgumentCaptor.forClass(byte[].class);
        verify(session, atMost(2)).sendBinary(captor.capture());
        verify(session, atLeast(2)).sendBinary(any());

        byte[] frame = captor.getValue();
        assertNotNull(frame);
        assertTrue(frame.length > 8);

        ByteBuffer buf = ByteBuffer.wrap(frame);
        assertEquals(1, buf.get());
        assertEquals(0, buf.get());
        int w = buf.getShort() & 0xFFFF;
        int h = buf.getShort() & 0xFFFF;
        assertEquals(1920, w); // scale 100 default
        assertEquals(1080, h);

        module.onClose(session);

        // Test thread cleanup
        Thread.sleep(200);
        for (Thread t : Thread.getAllStackTraces().keySet()) {
            if (t.getName().startsWith("ScreenCap-test-1") ||
                t.getName().startsWith("ScreenEnc-test-1") ||
                t.getName().startsWith("ScreenSnd-test-1") ||
                t.getName().startsWith("CursorSnd-test-1")) {
                assertFalse(t.isAlive(), "Thread " + t.getName() + " should be dead");
            }
        }
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
        data.put("quality", 200);
        data.put("scale", 10);
        data.put("fps", 50); // above 30 limit
        
        module.onMessage(session, "settings", data);
        module.onClose(session);
    }
}
