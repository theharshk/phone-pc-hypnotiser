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

@Controller
@RequestMapping("/admin")
public class AdminController {

    private final ConfigStore configStore;
    private final PendingApprovalStore pendingApprovalStore;
    private final com.phoneremote.ws.LockoutTracker lockoutTracker;

    public AdminController(ConfigStore configStore, PendingApprovalStore pendingApprovalStore, com.phoneremote.ws.LockoutTracker lockoutTracker) {
        this.configStore = configStore;
        this.pendingApprovalStore = pendingApprovalStore;
        this.lockoutTracker = lockoutTracker;
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

    @GetMapping(produces = "text/html")
    @ResponseBody
    public String adminPage(HttpServletRequest request, HttpServletResponse response) throws IOException {
        if (!checkAccess(request, response)) return null;

        HttpSession session = request.getSession(true);
        if (session.getAttribute("csrf_token") == null) {
            session.setAttribute("csrf_token", UUID.randomUUID().toString());
        }
        String csrf = (String) session.getAttribute("csrf_token");

        StringBuilder html = new StringBuilder();
        html.append("<html><head><title>Phone Remote Admin</title>");
        html.append("<style>body{font-family:sans-serif; padding: 20px;} .card{border:1px solid #ccc; padding:10px; margin-bottom:10px; border-radius:4px;}</style>");
        html.append("</head><body>");
        html.append("<h1>Phone Remote Admin</h1>");

        html.append("<h2>How to Connect</h2>");
        html.append("<div class='card'><ol>");
        html.append("<li>Set your 6-digit PIN in the <strong>Security Settings</strong> section at the bottom of this page (if you haven't already).</li>");
        html.append("<li>Ensure your phone and this PC are connected to the <strong>same WiFi network</strong>.</li>");
        html.append("<li>Open the link below in your phone's web browser.</li>");
        html.append("<li>When prompted on your phone, enter your 6-digit PIN.</li>");
        html.append("</ol><ul>");
        for (String ip : getLocalIpAddresses()) {
            String url = "http://" + ip + ":8080";
            html.append("<li><a href='").append(url).append("' target='_blank'>").append(url).append("</a></li>");
        }
        html.append("</ul></div>");

        html.append("<h2>Pending Approvals</h2>");
        if (pendingApprovalStore.getAll().isEmpty()) {
            html.append("<p>No pending approvals.</p>");
        } else {
            for (PendingApprovalStore.PendingDevice dev : pendingApprovalStore.getAll().values()) {
                html.append("<div class='card'>")
                    .append("<strong>").append(escapeHtml(dev.name)).append("</strong> (IP: ").append(escapeHtml(dev.ip)).append(")")
                    .append("<form method='post' action='/admin/approve' style='display:inline;'>")
                    .append("<input type='hidden' name='csrf' value='").append(csrf).append("'>")
                    .append("<input type='hidden' name='deviceId' value='").append(escapeHtml(dev.deviceId)).append("'>")
                    .append("<input type='hidden' name='action' value='approve'>")
                    .append("<button type='submit'>Approve</button></form> ")
                    .append("<form method='post' action='/admin/approve' style='display:inline;'>")
                    .append("<input type='hidden' name='csrf' value='").append(csrf).append("'>")
                    .append("<input type='hidden' name='deviceId' value='").append(escapeHtml(dev.deviceId)).append("'>")
                    .append("<input type='hidden' name='action' value='reject'>")
                    .append("<button type='submit'>Reject</button></form>")
                    .append("</div>");
            }
        }

        html.append("<h2>Paired Devices</h2>");
        if (configStore.getDevices().isEmpty()) {
            html.append("<p>No paired devices.</p>");
        } else {
            for (ConfigStore.DeviceInfo dev : configStore.getDevices()) {
                html.append("<div class='card'>")
                    .append("<strong>").append(escapeHtml(dev.name)).append("</strong> ")
                    .append("(Last seen: ").append(dev.lastSeen).append(", IP: ").append(escapeHtml(dev.lastIp)).append(")")
                    .append("<form method='post' action='/admin/revoke' style='margin-top:5px;'>")
                    .append("<input type='hidden' name='csrf' value='").append(csrf).append("'>")
                    .append("<input type='hidden' name='deviceId' value='").append(escapeHtml(dev.deviceId)).append("'>")
                    .append("<button type='submit'>Revoke</button></form>")
                    .append("</div>");
            }
            html.append("<form method='post' action='/admin/revoke' style='margin-top:10px;'>")
                .append("<input type='hidden' name='csrf' value='").append(csrf).append("'>")
                .append("<input type='hidden' name='action' value='all'>")
                .append("<button type='submit' style='background-color:#f44336;color:white;padding:5px 10px;border:none;border-radius:4px;cursor:pointer;'>Revoke All Devices</button></form>");
        }

        html.append("<h2>Security Settings</h2>");
        html.append("<div class='card'>")
            .append("<form method='post' action='/admin/pin'>")
            .append("<input type='hidden' name='csrf' value='").append(csrf).append("'>")
            .append("<p>Status: ").append(configStore.isPinSet() ? "PIN is set." : "No PIN set (Manual approval mode).").append("</p>")
            .append("<input type='text' name='pin' placeholder='6-digit PIN' maxlength='6' pattern='\\d{6}'> ")
            .append("<button type='submit' name='action' value='set'>Set/Change PIN</button> ")
            .append("<button type='submit' name='action' value='remove'>Remove PIN</button>")
            .append("</form>")
            .append("<form method='post' action='/admin/clear_lockouts' style='margin-top:15px;'>")
            .append("<input type='hidden' name='csrf' value='").append(csrf).append("'>")
            .append("<button type='submit' style='background-color:#4caf50;color:white;padding:5px 10px;border:none;border-radius:4px;cursor:pointer;'>Clear All Lockouts</button>")
            .append("</form></div>");

        html.append("</body></html>");
        return html.toString();
    }

    @PostMapping("/approve")
    public String handleApprove(HttpServletRequest request, HttpServletResponse response) throws IOException {
        if (!checkAccess(request, response)) return null;
        if (!verifyCsrfAndOrigin(request)) { response.sendError(400, "Invalid CSRF/Origin"); return null; }

        String deviceId = request.getParameter("deviceId");
        String action = request.getParameter("action");
        if (deviceId != null && action != null) {
            pendingApprovalStore.resolve(deviceId, "approve".equals(action));
        }
        return "redirect:/admin";
    }

    @PostMapping("/revoke")
    public String handleRevoke(HttpServletRequest request, HttpServletResponse response) throws IOException {
        if (!checkAccess(request, response)) return null;
        if (!verifyCsrfAndOrigin(request)) { response.sendError(400, "Invalid CSRF/Origin"); return null; }

        String action = request.getParameter("action");
        if ("all".equals(action)) {
            configStore.removeAllDevices();
        } else {
            String deviceId = request.getParameter("deviceId");
            if (deviceId != null) {
                configStore.removeDevice(deviceId);
            }
        }
        return "redirect:/admin";
    }

    @PostMapping("/pin")
    public String handlePin(HttpServletRequest request, HttpServletResponse response) throws IOException {
        if (!checkAccess(request, response)) return null;
        if (!verifyCsrfAndOrigin(request)) { response.sendError(400, "Invalid CSRF/Origin"); return null; }

        String action = request.getParameter("action");
        if ("remove".equals(action)) {
            configStore.setPin(null);
        } else if ("set".equals(action)) {
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
}
