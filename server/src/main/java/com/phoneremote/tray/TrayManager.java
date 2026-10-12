package com.phoneremote.tray;

import com.phoneremote.autostart.AutoStartManager;
import com.phoneremote.util.NetworkUtil;
import com.phoneremote.ws.RemoteSocketHandler;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.ApplicationListener;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;

import javax.imageio.ImageIO;
import java.io.InputStream;
import java.awt.*;
import java.awt.image.BufferedImage;
import java.net.URI;

@Component
public class TrayManager implements ApplicationListener<ApplicationReadyEvent> {

    private static final Logger logger = LoggerFactory.getLogger(TrayManager.class);

    private final RemoteSocketHandler socketHandler;
    private final AutoStartManager autoStartManager;
    private final Environment environment;
    private final ConfigurableApplicationContext context;

    public TrayManager(RemoteSocketHandler socketHandler,
                       AutoStartManager autoStartManager,
                       Environment environment,
                       ConfigurableApplicationContext context) {
        this.socketHandler = socketHandler;
        this.autoStartManager = autoStartManager;
        this.environment = environment;
        this.context = context;
    }

    public static Image createIconImage() {
        try (InputStream is = TrayManager.class.getResourceAsStream("/icon.png")) {
            if (is != null) {
                BufferedImage img = ImageIO.read(is);
                if (img != null) {
                    return img;
                }
            }
        } catch (Exception e) {
            logger.warn("Could not load /icon.png from classpath, falling back to generated icon: {}", e.getMessage());
        }

        BufferedImage image = new BufferedImage(16, 16, BufferedImage.TYPE_INT_ARGB);
        Graphics2D g = image.createGraphics();
        g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);

        // Dark rounded phone body
        g.setColor(new Color(26, 31, 43));
        g.fillRoundRect(2, 1, 12, 14, 3, 3);

        // Screen area
        g.setColor(new Color(47, 91, 255));
        g.fillRect(4, 3, 8, 9);

        // Home button indicator
        g.setColor(new Color(242, 245, 250));
        g.fillRect(7, 13, 2, 1);

        g.dispose();
        return image;
    }

    @Override
    public void onApplicationEvent(ApplicationReadyEvent event) {
        if (GraphicsEnvironment.isHeadless() || !SystemTray.isSupported()) {
            logger.info("SystemTray is not supported on this platform, continuing without it.");
            return;
        }

        try {
            int port = 8080;
            String portStr = environment.getProperty("local.server.port", environment.getProperty("server.port", "8080"));
            try {
                port = Integer.parseInt(portStr);
            } catch (NumberFormatException ignored) {}

            String ip = NetworkUtil.getLocalIpAddress();
            String address = "http://" + ip + ":" + port;

            SystemTray tray = SystemTray.getSystemTray();
            PopupMenu popup = new PopupMenu();

            MenuItem statusItem = new MenuItem("Phone Remote: Running (" + address + ")");
            statusItem.setEnabled(false);
            popup.add(statusItem);
            popup.addSeparator();

            final int serverPort = port;
            MenuItem adminItem = new MenuItem("Open admin");
            adminItem.addActionListener(e -> {
                try {
                    if (Desktop.isDesktopSupported() && Desktop.getDesktop().isSupported(Desktop.Action.BROWSE)) {
                        Desktop.getDesktop().browse(new URI("http://localhost:" + serverPort + "/admin"));
                    }
                } catch (Exception ex) {
                    logger.error("Failed to open admin URL", ex);
                }
            });
            popup.add(adminItem);

            MenuItem disableItem = new MenuItem("Disable remote control now");
            disableItem.addActionListener(e -> {
                boolean nextState = !socketHandler.isRemoteControlEnabled();
                socketHandler.setRemoteControlEnabled(nextState);
                disableItem.setLabel(nextState ? "Disable remote control now" : "Enable remote control");
            });
            popup.add(disableItem);

            boolean autoStartEnabled = false;
            try {
                autoStartEnabled = autoStartManager.isAutoStartEnabled();
            } catch (Exception ignored) {}

            MenuItem autoStartItem = new MenuItem(autoStartEnabled ? "Disable auto-start" : "Enable auto-start");
            autoStartItem.addActionListener(e -> {
                try {
                    if (autoStartManager.isAutoStartEnabled()) {
                        if (autoStartManager.disableAutoStart()) {
                            autoStartItem.setLabel("Enable auto-start");
                        } else {
                            logger.warn("Failed to disable auto-start");
                            autoStartItem.setLabel("Disable auto-start");
                        }
                    } else {
                        if (autoStartManager.enableAutoStart()) {
                            autoStartItem.setLabel("Disable auto-start");
                        } else {
                            logger.warn("Failed to enable auto-start");
                            autoStartItem.setLabel("Enable auto-start");
                        }
                    }
                } catch (Exception ex) {
                    logger.error("Failed to toggle auto-start", ex);
                }
            });
            popup.add(autoStartItem);
            popup.addSeparator();

            MenuItem quitItem = new MenuItem("Quit");
            quitItem.addActionListener(e -> {
                try {
                    socketHandler.cleanShutdown();
                } finally {
                    new Thread(() -> {
                        try {
                            context.close();
                        } finally {
                            System.exit(0);
                        }
                    }).start();
                }
            });
            popup.add(quitItem);

            TrayIcon trayIcon = new TrayIcon(createIconImage(), "Phone Remote", popup);
            trayIcon.setImageAutoSize(true);
            tray.add(trayIcon);
        } catch (Exception e) {
            logger.error("Failed to initialize SystemTray icon", e);
        }
    }
}
