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
        InMemoryLogAppender.clear();
        controller = new AdminController(null, null, null);
        controller.initLogging();

        LoggerContext lc = (LoggerContext) org.slf4j.LoggerFactory.getILoggerFactory();
        if (lc.getLogger("com.phoneremote.frames").getAppender("ASYNC_FRAME_FILE") == null) {
            try {
                ch.qos.logback.classic.joran.JoranConfigurator configurator = new ch.qos.logback.classic.joran.JoranConfigurator();
                configurator.setContext(lc);
                configurator.doConfigure(getClass().getResourceAsStream("/logback-spring.xml"));
            } catch (Exception ignored) {}
        }
    }

    @Test
    void testRingBufferSizeLimit() {
        LoggerContext lc = new LoggerContext();
        InMemoryLogAppender appender = new InMemoryLogAppender();
        appender.setContext(lc);
        appender.start();
        ch.qos.logback.classic.Logger logger = lc.getLogger("test");
        for (int i = 0; i < 600; i++) {
            LoggingEvent event = new LoggingEvent("test", logger, Level.INFO, "Message " + i, null, null);
            appender.doAppend(event);
        }
        
        List<ILoggingEvent> events = InMemoryLogAppender.getEvents();
        assertEquals(500, events.size(), "Ring buffer should not exceed 500");
        assertEquals("Message 100", events.get(0).getMessage());
    }

    @Test
    void testLogFilteringAndHtmlEscaping() throws Exception {
        LoggerContext lc = new LoggerContext();
        InMemoryLogAppender appender = new InMemoryLogAppender();
        appender.setContext(lc);
        appender.start();
        ch.qos.logback.classic.Logger logger = lc.getLogger("test");
        LoggingEvent event = new LoggingEvent("test", logger, Level.INFO, "Test <script>alert(1)</script>", null, null);
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
        ch.qos.logback.classic.Logger frameLogger = (ch.qos.logback.classic.Logger) org.slf4j.LoggerFactory.getLogger("com.phoneremote.frames");
        
        ch.qos.logback.classic.AsyncAppender asyncAppender = (ch.qos.logback.classic.AsyncAppender) frameLogger.getAppender("ASYNC_FRAME_FILE");
        assertNotNull(asyncAppender, "ASYNC_FRAME_FILE appender should be present to prevent blocking capture thread");
        assertTrue(asyncAppender.isNeverBlock(), "neverBlock must be true to protect capture thread");

        ch.qos.logback.core.rolling.RollingFileAppender fileAppender = (ch.qos.logback.core.rolling.RollingFileAppender) asyncAppender.getAppender("FRAME_FILE");
        assertNotNull(fileAppender);
        ch.qos.logback.core.rolling.SizeAndTimeBasedRollingPolicy policy = (ch.qos.logback.core.rolling.SizeAndTimeBasedRollingPolicy) fileAppender.getTriggeringPolicy();
        assertEquals(3, policy.getMaxHistory(), "Must keep exactly 3 files for frames");

        assertEquals(ch.qos.logback.classic.Level.DEBUG, frameLogger.getLevel(), "com.phoneremote.frames must default to DEBUG for frame logging");
        assertFalse(frameLogger.isAdditive(), "Frame logs must not be additive to prevent filling the App log");
    }
}
