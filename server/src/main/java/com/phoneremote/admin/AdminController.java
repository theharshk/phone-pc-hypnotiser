package com.phoneremote.admin;

import com.phoneremote.config.ConfigStore;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpSession;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseBody;

import java.io.IOException;
import java.util.UUID;
import java.util.regex.Pattern;

import jakarta.annotation.PostConstruct;

@Controller
@RequestMapping("/admin")
public class AdminController {

    private static final long START_TIME = System.currentTimeMillis();

    private final ConfigStore configStore;
    private final com.phoneremote.ws.LockoutTracker lockoutTracker;
    private final com.phoneremote.ws.RemoteSocketHandler socketHandler;

    public AdminController(ConfigStore configStore, com.phoneremote.ws.LockoutTracker lockoutTracker, com.phoneremote.ws.RemoteSocketHandler socketHandler) {
        this.configStore = configStore;
        this.lockoutTracker = lockoutTracker;
        this.socketHandler = socketHandler;
    }

    @PostConstruct
    public void initLogging() {
        ch.qos.logback.classic.LoggerContext lc = (ch.qos.logback.classic.LoggerContext) org.slf4j.LoggerFactory.getILoggerFactory();
        ch.qos.logback.classic.Logger rootLogger = lc.getLogger(org.slf4j.Logger.ROOT_LOGGER_NAME);
        com.phoneremote.logging.InMemoryLogAppender appender = new com.phoneremote.logging.InMemoryLogAppender();
        appender.setContext(lc);
        appender.start();
        rootLogger.addAppender(appender);
        
        org.slf4j.LoggerFactory.getLogger(AdminController.class).info("Logging started");
    }

    private boolean isLoopback(HttpServletRequest request) {
        String addr = request.getRemoteAddr();
        return "127.0.0.1".equals(addr) || "0:0:0:0:0:0:0:1".equals(addr);
    }

    private boolean isValidHost(HttpServletRequest request) {
        String host = request.getHeader("Host");
        return host != null && (host.equals("localhost:8080") || host.equals("127.0.0.1:8080") || host.equals("localhost") || host.equals("127.0.0.1"));
    }

    private boolean checkAccess(HttpServletRequest request, HttpServletResponse response) throws IOException {
        if (!isLoopback(request) || !isValidHost(request)) {
            response.sendError(403, "Access denied. Loopback only.");
            return false;
        }
        return true;
    }

    private boolean verifyCsrfAndOrigin(HttpServletRequest request) {
        String sessionCsrf = (String) request.getSession().getAttribute("csrf_token");
        String paramCsrf = request.getParameter("csrf");
        if (sessionCsrf == null || !sessionCsrf.equals(paramCsrf)) {
            return false;
        }

        String origin = request.getHeader("Origin");
        if (origin != null) {
            String host = request.getHeader("Host");
            if (host != null && !origin.endsWith(host)) {
                return false;
            }
        }
        return true;
    }

    private String escapeHtml(String input) {
        if (input == null) return "";
        return input.replace("&", "&amp;")
                    .replace("<", "&lt;")
                    .replace(">", "&gt;")
                    .replace("\"", "&quot;")
                    .replace("'", "&#x27;");
    }

    private java.util.List<String> getLocalIpAddresses() {
        java.util.List<String> ips = new java.util.ArrayList<>();
        try {
            java.util.Enumeration<java.net.NetworkInterface> interfaces = java.net.NetworkInterface.getNetworkInterfaces();
            while (interfaces.hasMoreElements()) {
                java.net.NetworkInterface iface = interfaces.nextElement();
                if (iface.isLoopback() || !iface.isUp()) continue;
                java.util.Enumeration<java.net.InetAddress> addresses = iface.getInetAddresses();
                while(addresses.hasMoreElements()) {
                    java.net.InetAddress addr = addresses.nextElement();
                    if (addr instanceof java.net.Inet4Address && !addr.isLinkLocalAddress()) {
                        ips.add(addr.getHostAddress());
                    }
                }
            }
        } catch (Exception e) {}
        if (ips.isEmpty()) {
            try {
                ips.add(java.net.InetAddress.getLocalHost().getHostAddress());
            } catch (Exception e) {}
        }
        return ips;
    }

    private String renderSPA(HttpServletRequest request) throws IOException {
        HttpSession session = request.getSession(true);
        if (session.getAttribute("csrf_token") == null) {
            session.setAttribute("csrf_token", UUID.randomUUID().toString());
        }
        String csrf = (String) session.getAttribute("csrf_token");

        java.io.File f = new java.io.File("web/admin/index.html");
        if (!f.exists()) {
            f = new java.io.File("../web/admin/index.html");
        }
        if (!f.exists()) return "Missing web/admin/index.html";
        String html = new String(java.nio.file.Files.readAllBytes(f.toPath()), java.nio.charset.StandardCharsets.UTF_8);
        
        // Inject CSRF token via a meta tag
        html = html.replace("<head>", "<head><meta name=\"csrf-token\" content=\"" + csrf + "\">");
        return html;
    }

    @GetMapping(produces = "text/html;charset=UTF-8")
    @ResponseBody
    public String adminPage(HttpServletRequest request, HttpServletResponse response) throws IOException {
        if (!checkAccess(request, response)) return null;
        return renderSPA(request);
    }

    @GetMapping(value = "/logs", produces = "text/html;charset=UTF-8")
    @ResponseBody
    public String logsPage(HttpServletRequest request, HttpServletResponse response) throws IOException {
        if (!checkAccess(request, response)) return null;
        return renderSPA(request);
    }

    @PostMapping("/revoke")
    public String handleRevoke(HttpServletRequest request, HttpServletResponse response) throws IOException {
        if (!checkAccess(request, response)) return null;
        if (!verifyCsrfAndOrigin(request)) { response.sendError(400, "Invalid CSRF/Origin"); return null; }

        String action = request.getParameter("action");
        if ("all".equals(action)) {
            configStore.removeAllDevices();
            socketHandler.revokeAllDevices();
        } else {
            String deviceId = request.getParameter("deviceId");
            if (deviceId != null) {
                configStore.removeDevice(deviceId);
                socketHandler.revokeDevice(deviceId);
            }
        }
        return "redirect:/admin";
    }

    @PostMapping("/security")
    public String handleSecurity(HttpServletRequest request, HttpServletResponse response) throws IOException {
        if (!checkAccess(request, response)) return null;
        if (!verifyCsrfAndOrigin(request)) { response.sendError(400, "Invalid CSRF/Origin"); return null; }

        String pinAction = request.getParameter("pinAction");
        if ("remove".equals(pinAction)) {
            configStore.setPin(null);
        } else if ("set".equals(pinAction)) {
            String pin = request.getParameter("pin");
            if (pin != null && Pattern.matches("^\\d{6}$", pin)) {
                configStore.setPin(pin);
            }
        }
        return "redirect:/admin";
    }

    @PostMapping("/clear_lockouts")
    public String handleClearLockouts(HttpServletRequest request, HttpServletResponse response) throws IOException {
        if (!checkAccess(request, response)) return null;
        if (!verifyCsrfAndOrigin(request)) { response.sendError(400, "Invalid CSRF/Origin"); return null; }

        lockoutTracker.clearAll();
        return "redirect:/admin";
    }

    @PostMapping("/logs/level")
    public String toggleLogLevel(HttpServletRequest request, HttpServletResponse response) throws IOException {
        if (!checkAccess(request, response)) return null;
        if (!verifyCsrfAndOrigin(request)) { response.sendError(400, "Invalid CSRF/Origin"); return null; }

        ch.qos.logback.classic.Logger root = (ch.qos.logback.classic.Logger) org.slf4j.LoggerFactory.getLogger("com.phoneremote");
        if (root.getLevel() == ch.qos.logback.classic.Level.DEBUG) {
            root.setLevel(ch.qos.logback.classic.Level.INFO);
        } else {
            root.setLevel(ch.qos.logback.classic.Level.DEBUG);
        }
        return "redirect:/admin/logs";
    }

    @GetMapping(value = "/api/logs", produces = "application/json")
    @ResponseBody
    public String apiLogs(HttpServletRequest request, HttpServletResponse response) throws IOException {
        if (!checkAccess(request, response)) return null;
        String level = request.getParameter("level");
        String search = request.getParameter("search");
        
        java.util.List<ch.qos.logback.classic.spi.ILoggingEvent> events = com.phoneremote.logging.InMemoryLogAppender.getEvents();
        int max = Math.min(200, events.size());
        events = events.subList(events.size() - max, events.size());

        com.fasterxml.jackson.databind.node.ArrayNode arr = new com.fasterxml.jackson.databind.ObjectMapper().createArrayNode();
        for (ch.qos.logback.classic.spi.ILoggingEvent e : events) {
            if (level != null && !level.isEmpty() && !e.getLevel().toString().equals(level)) continue;
            String formatted = e.getFormattedMessage();
            if (search != null && !search.isEmpty() && !formatted.toLowerCase().contains(search.toLowerCase())) continue;
            
            com.fasterxml.jackson.databind.node.ObjectNode node = arr.addObject();
            node.put("level", e.getLevel().toString());
            node.put("formatted", escapeHtml(java.time.Instant.ofEpochMilli(e.getTimeStamp()).toString() + " [" + e.getThreadName() + "] " + e.getLevel() + " " + e.getLoggerName() + " - " + formatted));
        }
        
        com.fasterxml.jackson.databind.node.ObjectNode res = new com.fasterxml.jackson.databind.ObjectMapper().createObjectNode();
        res.set("logs", arr);
        return res.toString();
    }

    @PostMapping(value = "/api/lockouts", produces = "application/json")
    @ResponseBody
    public String clearLockouts(HttpServletRequest request, HttpServletResponse response) throws IOException {
        if (!checkAccess(request, response)) return null;
        if (!verifyCsrfAndOrigin(request)) {
            response.setStatus(403);
            return "{\"success\":false,\"error\":\"CSRF or Origin invalid\"}";
        }
        
        String action = request.getParameter("action");
        if ("clear".equals(action)) {
            lockoutTracker.clearAll();
            return "{\"success\":true}";
        }
        
        response.setStatus(400);
        return "{\"success\":false,\"error\":\"Invalid action\"}";
    }

    @GetMapping(value = "/api/state", produces = "application/json")
    @ResponseBody
    public String apiState(HttpServletRequest request, HttpServletResponse response) throws IOException {
        if (!checkAccess(request, response)) return null;
        
        com.fasterxml.jackson.databind.ObjectMapper om = new com.fasterxml.jackson.databind.ObjectMapper();
        com.fasterxml.jackson.databind.node.ObjectNode res = om.createObjectNode();
        
        com.fasterxml.jackson.databind.node.ArrayNode devicesNode = om.createArrayNode();
        for (ConfigStore.DeviceInfo d : configStore.getDevices()) {
            com.fasterxml.jackson.databind.node.ObjectNode dev = om.createObjectNode();
            dev.put("deviceId", escapeHtml(d.deviceId));
            dev.put("name", escapeHtml(d.name));
            dev.put("lastSeen", d.lastSeen);
            dev.put("lastIp", escapeHtml(d.lastIp));
            dev.put("created", d.created);
            devicesNode.add(dev);
        }
        res.set("devices", devicesNode);
        
        com.fasterxml.jackson.databind.node.ArrayNode pendingNode = om.createArrayNode();
        if (socketHandler != null) {
            for (com.phoneremote.ws.RemoteSocketHandler.PendingApproval p : socketHandler.getPendingApprovals()) {
                com.fasterxml.jackson.databind.node.ObjectNode pNode = om.createObjectNode();
                pNode.put("deviceId", escapeHtml(p.deviceId));
                pNode.put("name", escapeHtml(p.deviceName));
                pNode.put("ip", escapeHtml(p.ip));
                pendingNode.add(pNode);
            }
        }
        res.set("pending", pendingNode);
        
        com.phoneremote.module.ScreenStats.Averages stats = com.phoneremote.module.ScreenModule.globalStats.getAverages();
        com.fasterxml.jackson.databind.node.ObjectNode statsNode = om.createObjectNode();
        statsNode.put("fps", stats.fps);
        statsNode.put("skippedFrames", stats.skippedFrames);
        statsNode.put("captureMs", stats.captureMs);
        statsNode.put("scaleMs", stats.scaleMs);
        statsNode.put("encodeMs", stats.encodeMs);
        statsNode.put("frameSizeKB", stats.frameSizeKB);
        com.fasterxml.jackson.databind.node.ArrayNode framesNode = om.createArrayNode();
        for (com.phoneremote.module.ScreenStats.FrameStat fs : com.phoneremote.module.ScreenModule.globalStats.getRecentFrames(20)) {
            com.fasterxml.jackson.databind.node.ObjectNode fNode = om.createObjectNode();
            fNode.put("timestamp", fs.timestamp);
            fNode.put("captureMs", fs.captureMs);
            fNode.put("scaleMs", fs.scaleMs);
            fNode.put("encodeMs", fs.encodeMs);
            fNode.put("frameSizeKB", fs.frameSizeKB);
            fNode.put("skipped", fs.skipped);
            framesNode.add(fNode);
        }
        statsNode.set("recentFrames", framesNode);
        
        res.set("stats", statsNode);
        
        res.put("pinSet", configStore.isPinSet());
        res.put("activeSessions", socketHandler.getActiveSessionCount());
        res.put("uptimeSeconds", (System.currentTimeMillis() - START_TIME) / 1000);
        
        com.fasterxml.jackson.databind.node.ArrayNode ipsNode = om.createArrayNode();
        for (String ip : getLocalIpAddresses()) {
            ipsNode.add(ip);
        }
        res.set("localIps", ipsNode);
        
        return res.toString();
    }

    @GetMapping("/logs/download")
    public void downloadLogs(HttpServletRequest request, HttpServletResponse response) throws IOException {
        if (!checkAccess(request, response)) return;
        java.io.File logFile = new java.io.File("logs/phoneremote.log");
        if (!logFile.exists()) {
            response.sendError(404, "Log file not found");
            return;
        }
        response.setContentType("text/plain");
        response.setHeader("Content-Disposition", "attachment; filename=\"phoneremote.log\"");
        java.nio.file.Files.copy(logFile.toPath(), response.getOutputStream());
        response.getOutputStream().flush();
    }

    @PostMapping(value = "/approve", produces = "application/json")
    @ResponseBody
    public String handleApprove(HttpServletRequest request, HttpServletResponse response) throws IOException {
        if (!checkAccess(request, response)) return null;
        if (!verifyCsrfAndOrigin(request)) {
            response.setStatus(403);
            return "{\"success\":false,\"error\":\"CSRF or Origin invalid\"}";
        }
        String deviceId = request.getParameter("deviceId");
        String action = request.getParameter("action");
        if (deviceId == null || action == null) {
            response.setStatus(400);
            return "{\"success\":false,\"error\":\"Missing parameters\"}";
        }
        if ("approve".equals(action)) {
            boolean approved = socketHandler != null && socketHandler.approvePendingDevice(deviceId);
            if (approved) {
                return "{\"success\":true}";
            } else {
                return "{\"success\":false,\"error\":\"Device not found or session closed\"}";
            }
        } else if ("reject".equals(action)) {
            if (socketHandler != null) {
                socketHandler.rejectPendingDevice(deviceId);
            }
            return "{\"success\":true}";
        }
        response.setStatus(400);
        return "{\"success\":false,\"error\":\"Invalid action\"}";
    }
}
