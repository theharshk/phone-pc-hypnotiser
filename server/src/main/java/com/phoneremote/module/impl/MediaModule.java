package com.phoneremote.module.impl;

import com.fasterxml.jackson.databind.JsonNode;
import com.phoneremote.adapter.InputAdapter;
import com.phoneremote.adapter.MediaKey;
import com.phoneremote.module.RemoteModule;
import com.phoneremote.ws.Session;
import org.springframework.stereotype.Component;

@Component
public class MediaModule implements RemoteModule {

    private final InputAdapter inputAdapter;

    public MediaModule(InputAdapter inputAdapter) {
        this.inputAdapter = inputAdapter;
    }

    @Override
    public String id() {
        return "media";
    }

    @Override
    public String displayName() {
        return "Media";
    }

    @Override
    public void onMessage(Session s, String type, JsonNode data) {
        if ("action".equals(type)) {
            String keyStr = data.path("key").asText("");
            try {
                MediaKey key = MediaKey.valueOf(keyStr);
                inputAdapter.mediaKey(key);
            } catch (IllegalArgumentException e) {
                // Invalid action, ignore
            }
        }
    }
}
