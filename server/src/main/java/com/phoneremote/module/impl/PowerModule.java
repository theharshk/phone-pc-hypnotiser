package com.phoneremote.module.impl;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.phoneremote.adapter.PowerAction;
import com.phoneremote.adapter.PowerAdapter;
import com.phoneremote.module.RemoteModule;
import com.phoneremote.ws.Session;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.logging.Logger;

@Component
public class PowerModule implements RemoteModule {

    private static final Logger logger = Logger.getLogger(PowerModule.class.getName());
    private final PowerAdapter powerAdapter;
    private final ObjectMapper mapper = new ObjectMapper();
    private final Map<String, TokenInfo> tokens = new ConcurrentHashMap<>();

    private static class TokenInfo {
        String sessionId;
        PowerAction action;
        long expiryTime;
    }

    public PowerModule(PowerAdapter powerAdapter) {
        this.powerAdapter = powerAdapter;
    }

    @Override
    public String id() { return "power"; }

    @Override
    public String displayName() { return "Power"; }

    @Override
    public void onMessage(Session s, String type, JsonNode data) {
        try {
            if ("request".equals(type)) {
                String actionStr = data.path("action").asText("");
                PowerAction action = PowerAction.valueOf(actionStr);
                
                String token = UUID.randomUUID().toString();
                TokenInfo info = new TokenInfo();
                info.sessionId = s.getId();
                info.action = action;
                info.expiryTime = System.currentTimeMillis() + 10000; // 10 seconds validity
                tokens.put(token, info);

                ObjectNode reply = mapper.createObjectNode();
                reply.put("m", "power");
                reply.put("t", "token");
                ObjectNode payload = mapper.createObjectNode();
                payload.put("token", token);
                payload.put("action", actionStr);
                reply.set("d", payload);
                s.send(mapper.writeValueAsString(reply));
                
            } else if ("execute".equals(type) || "schedule".equals(type)) {
                String token = data.path("token").asText("");
                String actionStr = data.path("action").asText("");
                PowerAction action = PowerAction.valueOf(actionStr);
                
                TokenInfo info = tokens.remove(token);
                if (info == null || info.expiryTime < System.currentTimeMillis() ||
                    !info.sessionId.equals(s.getId()) || info.action != action) {
                    
                    ObjectNode reply = mapper.createObjectNode();
                    reply.put("m", "power");
                    reply.put("t", "error");
                    s.send(mapper.writeValueAsString(reply));
                    return; 
                }

                // Send ACK first before executing
                ObjectNode reply = mapper.createObjectNode();
                reply.put("m", "power");
                reply.put("t", "ack");
                s.send(mapper.writeValueAsString(reply));

                // Wait briefly for ACK to reach socket buffer
                Thread.sleep(50);

                String deviceName = (String) s.getAttribute("deviceName");
                if (deviceName == null) deviceName = "Unknown Device";
                
                logger.info("Power action executed: " + action + " at " + Instant.now() + " by device: " + deviceName);

                if ("schedule".equals(type)) {
                    if (action == PowerAction.SHUTDOWN) {
                        int seconds = data.path("seconds").asInt(-1);
                        if (seconds >= 10 && seconds <= 3600) {
                            powerAdapter.delayedShutdown(seconds);
                        }
                    }
                } else {
                    executeAction(action);
                }
                
            } else if ("cancel".equals(type)) {
                String deviceName = (String) s.getAttribute("deviceName");
                if (deviceName == null) deviceName = "Unknown Device";
                logger.info("Power action cancelled: delayed shutdown at " + Instant.now() + " by device: " + deviceName);
                powerAdapter.cancelPending();
            }
        } catch (IllegalArgumentException e) {
            // Invalid enum value, ignore
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    private void executeAction(PowerAction action) {
        switch (action) {
            case SHUTDOWN: powerAdapter.shutdown(); break;
            case RESTART: powerAdapter.restart(); break;
            case SLEEP: powerAdapter.sleep(); break;
            case HIBERNATE: powerAdapter.hibernate(); break;
            case LOCK: powerAdapter.lock(); break;
        }
    }
}
