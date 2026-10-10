package com.phoneremote.module.impl;

import com.fasterxml.jackson.databind.JsonNode;
import com.phoneremote.adapter.InputAdapter;
import com.phoneremote.adapter.MouseButton;
import com.phoneremote.module.RemoteModule;
import com.phoneremote.ws.Session;
import org.springframework.stereotype.Component;

@Component
public class TouchpadModule implements RemoteModule {

    private final InputAdapter inputAdapter;
    private static final double SENSITIVITY = 1.4;

    public TouchpadModule(InputAdapter inputAdapter) {
        this.inputAdapter = inputAdapter;
    }

    @Override
    public String id() {
        return "touchpad";
    }

    @Override
    public String displayName() {
        return "Touchpad";
    }

    @Override
    public void onMessage(Session s, String type, JsonNode data) {
        switch (type) {
            case "move":
                int dx = data.path("dx").asInt(0);
                int dy = data.path("dy").asInt(0);
                if (Math.abs(dx) < 2000 && Math.abs(dy) < 2000) {
                    inputAdapter.moveRelative((int) (dx * SENSITIVITY), (int) (dy * SENSITIVITY));
                }
                break;
            case "down":
                inputAdapter.mouseDown(MouseButton.LEFT);
                s.setAttribute("touchpad.leftDown", true);
                break;
            case "up":
                inputAdapter.mouseUp(MouseButton.LEFT);
                s.setAttribute("touchpad.leftDown", false);
                break;
            case "click":
                inputAdapter.mouseDown(MouseButton.LEFT);
                inputAdapter.mouseUp(MouseButton.LEFT);
                break;
            case "rightClick":
                inputAdapter.mouseDown(MouseButton.RIGHT);
                inputAdapter.mouseUp(MouseButton.RIGHT);
                break;
            case "scroll":
                int amount = data.path("amount").asInt(0);
                if (Math.abs(amount) < 100) {
                    inputAdapter.scroll(amount);
                }
                break;
        }
    }

    @Override
    public void onClose(Session s) {
        if (Boolean.TRUE.equals(s.getAttribute("touchpad.leftDown"))) {
            inputAdapter.mouseUp(MouseButton.LEFT);
            s.removeAttribute("touchpad.leftDown");
        }
    }
}
