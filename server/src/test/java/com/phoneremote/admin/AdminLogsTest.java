package com.phoneremote.admin;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.LoggerContext;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.classic.spi.LoggingEvent;
import com.phoneremote.logging.InMemoryLogAppender;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class AdminLogsTest {

    private AdminController controller;

    @BeforeEach
    void setUp() {
        controller = new AdminController(null, null, null);
    }

    @Test
    void testRingBufferSizeLimit() {
        InMemoryLogAppender appender = new InMemoryLogAppender();
        LoggerContext lc = new LoggerContext();
        for (int i = 0; i < 600; i++) {
            LoggingEvent event = new LoggingEvent();
            event.setLevel(Level.INFO);
            event.setMessage("Message " + i);
            event.setLoggerContext(lc);
            appender.doAppend(event);
        }
        
        List<ILoggingEvent> events = InMemoryLogAppender.getEvents();
        assertEquals(500, events.size(), "Ring buffer should not exceed 500");
        assertEquals("Message 100", events.get(0).getMessage());
    }

    @Test
    void testLogFilteringAndHtmlEscaping() throws Exception {
        InMemoryLogAppender appender = new InMemoryLogAppender();
        LoggerContext lc = new LoggerContext();
        LoggingEvent event = new LoggingEvent();
        event.setLevel(Level.INFO);
        event.setMessage("Test <script>alert(1)</script>");
        event.setLoggerContext(lc);
        appender.doAppend(event);

        MockHttpServletRequest req = new MockHttpServletRequest();
        req.setRemoteAddr("127.0.0.1");
        req.addHeader("Host", "localhost:8080");
        req.setParameter("level", "INFO");
        req.setParameter("search", "script");

        MockHttpServletResponse res = new MockHttpServletResponse();
        String json = controller.apiLogs(req, res);

        assertNotNull(json);
        assertTrue(json.contains("&lt;script&gt;alert(1)&lt;/script&gt;"));
        assertFalse(json.contains("<script>"));
    }

    @Test
    void testAccessDeniedForNonLoopback() throws Exception {
        MockHttpServletRequest req = new MockHttpServletRequest();
        req.setRemoteAddr("192.168.1.5"); // Non-loopback
        req.addHeader("Host", "localhost:8080");

        MockHttpServletResponse res = new MockHttpServletResponse();
        String html = controller.logsPage(req, res);

        assertNull(html);
        assertEquals(403, res.getStatus());
    }

    @Test
    void testAccessDeniedForWrongHost() throws Exception {
        MockHttpServletRequest req = new MockHttpServletRequest();
        req.setRemoteAddr("127.0.0.1");
        req.addHeader("Host", "evil.com"); // Wrong host

        MockHttpServletResponse res = new MockHttpServletResponse();
        String html = controller.logsPage(req, res);

        assertNull(html);
        assertEquals(403, res.getStatus());
    }

    @Test
    void testLogbackConfiguration() {
        ch.qos.logback.classic.Logger root = (ch.qos.logback.classic.Logger) org.slf4j.LoggerFactory.getLogger(org.slf4j.Logger.ROOT_LOGGER_NAME);
        
        ch.qos.logback.classic.AsyncAppender asyncAppender = (ch.qos.logback.classic.AsyncAppender) root.getAppender("ASYNC_FILE");
        assertNotNull(asyncAppender, "ASYNC_FILE appender should be present to prevent blocking capture thread");
        assertTrue(asyncAppender.isNeverBlock(), "neverBlock must be true to protect capture thread");

        ch.qos.logback.core.rolling.RollingFileAppender fileAppender = (ch.qos.logback.core.rolling.RollingFileAppender) asyncAppender.getAppender("FILE");
        assertNotNull(fileAppender);
        ch.qos.logback.core.rolling.SizeAndTimeBasedRollingPolicy policy = (ch.qos.logback.core.rolling.SizeAndTimeBasedRollingPolicy) fileAppender.getTriggeringPolicy();
        assertEquals(3, policy.getMaxHistory(), "Must keep exactly 3 files");

        ch.qos.logback.classic.Logger phoneRemoteLogger = (ch.qos.logback.classic.Logger) org.slf4j.LoggerFactory.getLogger("com.phoneremote");
        assertEquals(ch.qos.logback.classic.Level.DEBUG, phoneRemoteLogger.getLevel(), "com.phoneremote must default to DEBUG for frame logging");
    }
}
