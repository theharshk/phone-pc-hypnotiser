package com.phoneremote.ws;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.phoneremote.module.ModuleRegistry;
import com.phoneremote.module.RemoteModule;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@Component
public class RemoteSocketHandler extends TextWebSocketHandler {

    private final ObjectMapper mapper = new ObjectMapper();
    private final ModuleRegistry moduleRegistry;
    private final Map<String, Session> sessions = new ConcurrentHashMap<>();
    private static final int MAX_PAYLOAD_LENGTH = 8192;

    public RemoteSocketHandler(ModuleRegistry moduleRegistry) {
        this.moduleRegistry = moduleRegistry;
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession wsSession) throws Exception {
        sessions.put(wsSession.getId(), new Session(wsSession));
        System.out.println("Connection established: " + wsSession.getId());
    }

    @Override
    protected void handleTextMessage(WebSocketSession wsSession, TextMessage message) throws Exception {
        String payload = message.getPayload();
        if (payload.length() > MAX_PAYLOAD_LENGTH) {
            wsSession.close(CloseStatus.BAD_DATA.withReason("Message too large"));
            return;
        }

        Session session = sessions.get(wsSession.getId());
        if (session == null) return;

        try {
            JsonNode root = mapper.readTree(payload);
            String m = root.path("m").asText("");
            String t = root.path("t").asText("");
            JsonNode d = root.path("d");

            if ("core".equals(m)) {
                handleCoreMessage(session, root, t, d);
            } else {
                RemoteModule module = moduleRegistry.get(m);
                if (module != null) {
                    session.execute(() -> {
                        try {
                            module.onMessage(session, t, d);
                        } catch (Exception e) {
                            System.err.println("Module error: " + e.getMessage());
                        }
                    });
                }
            }
        } catch (Exception e) {
            System.err.println("Invalid message: " + e.getMessage());
        }
    }

    private void handleCoreMessage(Session session, JsonNode root, String t, JsonNode d) throws Exception {
        if ("hello".equals(t)) {
            String deviceName = d.path("deviceName").asText("Unknown Device");
            session.setAttribute("deviceName", deviceName);

            ObjectNode response = mapper.createObjectNode();
            response.put("m", "core");
            response.put("t", "ready");

            ObjectNode data = mapper.createObjectNode();
            ArrayNode modulesArr = mapper.createArrayNode();
            for (RemoteModule mod : moduleRegistry.getAll()) {
                ObjectNode mObj = mapper.createObjectNode();
                mObj.put("id", mod.id());
                mObj.put("name", mod.displayName());
                modulesArr.add(mObj);
            }
            data.set("modules", modulesArr);
            response.set("d", data);

            session.send(mapper.writeValueAsString(response));
        } else if ("ping".equals(t)) {
            ObjectNode response = mapper.createObjectNode();
            response.put("m", "core");
            response.put("t", "pong");
            if (root.has("i")) {
                response.set("i", root.get("i"));
            }
            session.send(mapper.writeValueAsString(response));
        } else if ("open".equals(t)) {
            String moduleId = d.path("module").asText("");
            RemoteModule module = moduleRegistry.get(moduleId);
            if (module != null) {
                session.execute(() -> module.onOpen(session));
            }
        } else if ("close".equals(t)) {
            String moduleId = d.path("module").asText("");
            RemoteModule module = moduleRegistry.get(moduleId);
            if (module != null) {
                session.execute(() -> module.onClose(session));
            }
        }
    }

    @Override
    public void afterConnectionClosed(WebSocketSession wsSession, CloseStatus status) throws Exception {
        Session session = sessions.remove(wsSession.getId());
        if (session != null) {
            for (RemoteModule module : moduleRegistry.getAll()) {
                module.onClose(session);
            }
            session.close();
        }
        System.out.println("Connection closed: " + wsSession.getId());
    }
}
