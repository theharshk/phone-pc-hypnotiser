package com.phoneremote.module;

import com.fasterxml.jackson.databind.JsonNode;
import com.phoneremote.ws.Session;

public interface RemoteModule {
    String id();
    String displayName();
    default void onOpen(Session s) {}
    void onMessage(Session s, String type, JsonNode data);
    default void onClose(Session s) {}
}
