package com.phoneremote.step8;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.phoneremote.autostart.AutoStartManager;
import com.phoneremote.config.ConfigStore;
import com.phoneremote.module.ModuleRegistry;
import com.phoneremote.module.RemoteModule;
import com.phoneremote.startup.StartupReporter;
import com.phoneremote.terminal.TerminalPromptService;
import com.phoneremote.terminal.TerminalWizard;
import com.phoneremote.util.CommandRunner;
import com.phoneremote.ws.LockoutTracker;
import com.phoneremote.ws.RemoteSocketHandler;
import com.phoneremote.ws.Session;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.PrintStream;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

public class Step8Tests {

    private String tempDir;
    private ConfigStore configStore;
    private LockoutTracker lockoutTracker;
    private ObjectMapper mapper;

    @BeforeEach
    void setUp() throws Exception {
        tempDir = Files.createTempDirectory("step8test").toString();
        System.setProperty("user.dir", tempDir);
        System.setProperty("test.config.dir", tempDir);
        configStore = new ConfigStore();
        lockoutTracker = new LockoutTracker();
        mapper = new ObjectMapper();
    }

    // 1. Fake CommandRunner to capture arguments and return predetermined exit codes
    static class FakeCommandRunner implements CommandRunner {
        final List<List<String>> executedCommands = new ArrayList<>();
        int returnCode = 0;

        @Override
        public int run(List<String> command) throws Exception {
            executedCommands.add(new ArrayList<>(command));
            return returnCode;
        }
    }

    @Test
    void testSchtasksArgumentArrays() throws Exception {
        FakeCommandRunner fakeRunner = new FakeCommandRunner();
        AutoStartManager autoStart = new AutoStartManager(fakeRunner, "C:\\mock\\working\\dir");

        // Verify Create Task Arguments
        List<String> createArgs = autoStart.buildCreateTaskArgs();
        assertEquals(9, createArgs.size());
        assertEquals("schtasks", createArgs.get(0));
        assertEquals("/Create", createArgs.get(1));
        assertEquals("/F", createArgs.get(2));
        assertEquals("/TN", createArgs.get(3));
        assertEquals(AutoStartManager.TASK_NAME, createArgs.get(4));
        assertEquals("/SC", createArgs.get(5));
        assertEquals("ONLOGON", createArgs.get(6));
        assertEquals("/TR", createArgs.get(7));
        assertTrue(createArgs.get(8).contains("cd /d \"C:\\mock\\working\\dir\""));
        assertTrue(createArgs.get(8).contains("-jar server.jar"));

        // Enable auto-start execution
        fakeRunner.returnCode = 0;
        assertTrue(autoStart.enableAutoStart());
        assertEquals(1, fakeRunner.executedCommands.size());
        assertEquals(createArgs, fakeRunner.executedCommands.get(0));

        // Verify Delete Task Arguments
        List<String> deleteArgs = autoStart.buildDeleteTaskArgs();
        assertEquals(List.of("schtasks", "/Delete", "/F", "/TN", AutoStartManager.TASK_NAME), deleteArgs);

        fakeRunner.executedCommands.clear();
        assertTrue(autoStart.disableAutoStart());
        assertEquals(1, fakeRunner.executedCommands.size());
        assertEquals(deleteArgs, fakeRunner.executedCommands.get(0));

        // Verify Query Task Arguments
        List<String> queryArgs = autoStart.buildQueryTaskArgs();
        assertEquals(List.of("schtasks", "/Query", "/TN", AutoStartManager.TASK_NAME), queryArgs);

        fakeRunner.executedCommands.clear();
        assertTrue(autoStart.isAutoStartEnabled());
        assertEquals(1, fakeRunner.executedCommands.size());
        assertEquals(queryArgs, fakeRunner.executedCommands.get(0));

        // Failure code handling
        fakeRunner.returnCode = 1;
        assertFalse(autoStart.isAutoStartEnabled());
    }

    @Test
    void testBackgroundStartWithNoConfigExitsCleanly() throws Exception {
        File configFile = new File(tempDir, "config.json");
        if (configFile.exists()) configFile.delete();
        assertFalse(configStore.hasConfigFile());

        TerminalPromptService promptService = mock(TerminalPromptService.class);
        AtomicInteger exitStatus = new AtomicInteger(-1);

        ByteArrayOutputStream errStream = new ByteArrayOutputStream();
        PrintStream originalErr = System.err;
        System.setErr(new PrintStream(errStream));

        try {
            TerminalWizard wizard = new TerminalWizard(
                    configStore,
                    promptService,
                    () -> false, // No console
                    exitStatus::set
            );

            wizard.run();

            assertEquals(1, exitStatus.get(), "Background start with no config must exit with status 1");
            assertTrue(errStream.toString().contains("Run once from a terminal to set a PIN"));
            verifyNoInteractions(promptService);
        } finally {
            System.setErr(originalErr);
        }
    }

    @Test
    void testBackgroundStartWithSavedConfigDoesNotExitOrPrompt() throws Exception {
        configStore.setPin("123456");
        assertTrue(configStore.hasConfigFile());

        TerminalPromptService promptService = mock(TerminalPromptService.class);
        AtomicInteger exitStatus = new AtomicInteger(-1);

        TerminalWizard wizard = new TerminalWizard(
                configStore,
                promptService,
                () -> false, // No console
                exitStatus::set
        );

        wizard.run();

        assertEquals(-1, exitStatus.get(), "Must not call exit when saved config exists");
        verifyNoInteractions(promptService);
    }

    @Test
    void testDisableSwitchRejectsConnectionsAndRevokesOpen() throws Exception {
        RemoteModule mockModule = mock(RemoteModule.class);
        when(mockModule.id()).thenReturn("touchpad");
        when(mockModule.displayName()).thenReturn("Touchpad");
        ModuleRegistry registry = new ModuleRegistry(List.of(mockModule));

        RemoteSocketHandler handler = new RemoteSocketHandler(registry, configStore, lockoutTracker, mock(TerminalPromptService.class));

        String deviceId = "dev-disable-1";
        String token = "tok-disable-1";
        ConfigStore.DeviceInfo d = new ConfigStore.DeviceInfo();
        d.deviceId = deviceId;
        d.tokenHash = configStore.hashToken(token);
        configStore.addDevice(d);

        // 1. Establish and authenticate active session
        WebSocketSession ws1 = mock(WebSocketSession.class);
        when(ws1.getId()).thenReturn("ws-1");
        when(ws1.isOpen()).thenReturn(true);
        handler.afterConnectionEstablished(ws1);

        ObjectNode hello = mapper.createObjectNode();
        hello.put("m", "core");
        hello.put("t", "hello");
        ObjectNode helloD = mapper.createObjectNode();
        helloD.put("deviceId", deviceId);
        helloD.put("token", token);
        hello.set("d", helloD);
        handler.handleMessage(ws1, new TextMessage(mapper.writeValueAsString(hello)));

        assertEquals(1, handler.getActiveSessionCount());

        // 2. Disable remote control now
        handler.setRemoteControlEnabled(false);
        assertFalse(handler.isRemoteControlEnabled());

        // Verify active sessions revoked
        assertEquals(0, handler.getActiveSessionCount());
        verify(mockModule, atLeastOnce()).onClose(any(Session.class));
        verify(ws1, atLeastOnce()).close();

        // 3. New connection attempt while disabled should be closed immediately
        WebSocketSession ws2 = mock(WebSocketSession.class);
        when(ws2.getId()).thenReturn("ws-2");
        when(ws2.isOpen()).thenReturn(true);
        handler.afterConnectionEstablished(ws2);
        verify(ws2, times(1)).close();

        // 4. Re-enable remote control
        handler.setRemoteControlEnabled(true);
        assertTrue(handler.isRemoteControlEnabled());

        WebSocketSession ws3 = mock(WebSocketSession.class);
        when(ws3.getId()).thenReturn("ws-3");
        when(ws3.isOpen()).thenReturn(true);
        handler.afterConnectionEstablished(ws3);
        verify(ws3, never()).close();
    }

    @Test
    void testCleanShutdownReleasesKeysAndStopsModules() throws Exception {
        RemoteModule mockModule = mock(RemoteModule.class);
        when(mockModule.id()).thenReturn("keyboard");
        when(mockModule.displayName()).thenReturn("Keyboard");
        ModuleRegistry registry = new ModuleRegistry(List.of(mockModule));

        RemoteSocketHandler handler = new RemoteSocketHandler(registry, configStore, lockoutTracker, mock(TerminalPromptService.class));

        WebSocketSession ws = mock(WebSocketSession.class);
        when(ws.getId()).thenReturn("ws-clean");
        when(ws.isOpen()).thenReturn(true);
        handler.afterConnectionEstablished(ws);

        handler.cleanShutdown();

        verify(mockModule, times(1)).onClose(any(Session.class));
        verify(ws, times(1)).close();
        assertEquals(0, handler.getActiveSessionCount());
    }

    @Test
    void testNoPinApprovalWorkflow() throws Exception {
        // No PIN set
        configStore.setPin(null);
        assertFalse(configStore.isPinSet());

        RemoteSocketHandler handler = new RemoteSocketHandler(
                new ModuleRegistry(List.of()),
                configStore,
                lockoutTracker,
                mock(TerminalPromptService.class)
        );

        WebSocketSession ws = mock(WebSocketSession.class);
        when(ws.getId()).thenReturn("ws-no-pin");
        when(ws.isOpen()).thenReturn(true);
        handler.afterConnectionEstablished(ws);

        // 1. Device sends hello with no token
        ObjectNode hello = mapper.createObjectNode();
        hello.put("m", "core");
        hello.put("t", "hello");
        ObjectNode helloD = mapper.createObjectNode();
        helloD.put("deviceId", "phone-99");
        helloD.put("deviceName", "Pixel 9");
        hello.set("d", helloD);
        handler.handleMessage(ws, new TextMessage(mapper.writeValueAsString(hello)));

        // Verify phone receives pending_approval
        ArgumentCaptor<TextMessage> textCaptor = ArgumentCaptor.forClass(TextMessage.class);
        verify(ws, atLeastOnce()).sendMessage(textCaptor.capture());
        JsonNode reply = mapper.readTree(textCaptor.getValue().getPayload());
        assertEquals("pending_approval", reply.path("t").asText());

        // Verify pending queue has phone-99
        assertEquals(1, handler.getPendingApprovals().size());
        RemoteSocketHandler.PendingApproval pending = handler.getPendingApprovals().iterator().next();
        assertEquals("phone-99", pending.deviceId);
        assertEquals("Pixel 9", pending.deviceName);

        // 2. Admin approves device
        assertTrue(handler.approvePendingDevice("phone-99"));
        assertEquals(0, handler.getPendingApprovals().size());

        // Verify device is saved in config
        assertNotNull(configStore.getDevice("phone-99"));

        // Verify phone receives paired message with token
        verify(ws, atLeast(2)).sendMessage(textCaptor.capture());
        boolean receivedPaired = false;
        for (TextMessage tm : textCaptor.getAllValues()) {
            JsonNode msg = mapper.readTree(tm.getPayload());
            if ("paired".equals(msg.path("t").asText())) {
                receivedPaired = true;
                assertTrue(msg.path("d").path("token").asText().length() > 0);
            }
        }
        assertTrue(receivedPaired, "Device should receive paired message with token");
    }

    @Test
    void testNoPinRejectionWorkflow() throws Exception {
        configStore.setPin(null);
        RemoteSocketHandler handler = new RemoteSocketHandler(
                new ModuleRegistry(List.of()),
                configStore,
                lockoutTracker,
                mock(TerminalPromptService.class)
        );

        WebSocketSession ws = mock(WebSocketSession.class);
        when(ws.getId()).thenReturn("ws-deny");
        when(ws.isOpen()).thenReturn(true);
        handler.afterConnectionEstablished(ws);

        ObjectNode hello = mapper.createObjectNode();
        hello.put("m", "core");
        hello.put("t", "hello");
        ObjectNode helloD = mapper.createObjectNode();
        helloD.put("deviceId", "denied-phone");
        helloD.put("deviceName", "Unknown Phone");
        hello.set("d", helloD);
        handler.handleMessage(ws, new TextMessage(mapper.writeValueAsString(hello)));

        assertEquals(1, handler.getPendingApprovals().size());

        // Admin rejects
        assertTrue(handler.rejectPendingDevice("denied-phone"));
        assertEquals(0, handler.getPendingApprovals().size());
        assertNull(configStore.getDevice("denied-phone"));

        ArgumentCaptor<TextMessage> textCaptor = ArgumentCaptor.forClass(TextMessage.class);
        verify(ws, atLeastOnce()).sendMessage(textCaptor.capture());
        boolean foundRevoked = false;
        for (TextMessage tm : textCaptor.getAllValues()) {
            JsonNode msg = mapper.readTree(tm.getPayload());
            if ("revoked".equals(msg.path("d").path("code").asText())) {
                foundRevoked = true;
            }
        }
        assertTrue(foundRevoked, "Should receive revoked error on rejection");
        verify(ws, atLeastOnce()).close();
    }

    @Test
    void testStartupReporterMessage() {
        ByteArrayOutputStream outStream = new ByteArrayOutputStream();
        PrintStream printStream = new PrintStream(outStream);

        StartupReporter.printStartupAddresses("192.168.1.100", 8080, printStream);

        String output = outStream.toString();
        assertTrue(output.contains("Phone address: http://192.168.1.100:8080"));
        assertTrue(output.contains("Admin address: http://localhost:8080/admin"));
        assertFalse(output.contains("QR"));
    }
}
