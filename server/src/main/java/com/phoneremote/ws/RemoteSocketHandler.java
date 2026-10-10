package com.phoneremote.ws;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import java.util.Collections;

@Component
public class RemoteSocketHandler extends TextWebSocketHandler {

    private final ObjectMapper mapper = new ObjectMapper();

    @Override
    public void afterConnectionEstablished(WebSocketSession session) throws Exception {
        System.out.println("Connection established: " + session.getId());
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) throws Exception {
        String payload = message.getPayload();
        System.out.println("Received: " + payload);

        try {
            JsonNode root = mapper.readTree(payload);
            String m = root.path("m").asText();
            String t = root.path("t").asText();
            
            if ("core".equals(m)) {
                if ("hello".equals(t)) {
                    // Send ready
                    ObjectNode response = mapper.createObjectNode();
                    response.put("m", "core");
                    response.put("t", "ready");
                    ObjectNode data = mapper.createObjectNode();
                    data.set("modules", mapper.valueToTree(Collections.emptyList()));
                    response.set("d", data);
                    
                    session.sendMessage(new TextMessage(mapper.writeValueAsString(response)));
                } else if ("ping".equals(t)) {
                    // Send pong
                    ObjectNode response = mapper.createObjectNode();
                    response.put("m", "core");
                    response.put("t", "pong");
                    if (root.has("i")) {
                        response.set("i", root.get("i"));
                    }
                    session.sendMessage(new TextMessage(mapper.writeValueAsString(response)));
                }
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) throws Exception {
        System.out.println("Connection closed: " + session.getId());
    }
}
