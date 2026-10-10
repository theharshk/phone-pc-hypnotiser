package com.phoneremote.module.impl;

import com.fasterxml.jackson.databind.JsonNode;
import com.phoneremote.adapter.InputAdapter;
import com.phoneremote.module.RemoteModule;
import com.phoneremote.ws.Session;
import org.springframework.stereotype.Component;

import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;

@Component
public class KeyboardModule implements RemoteModule {

    private final InputAdapter inputAdapter;

    private static final int VK_CONTROL = 0x11;
    private static final int VK_MENU = 0x12; // Alt
    private static final int VK_SHIFT = 0x10;
    private static final int VK_LWIN = 0x5B;

    private static final Map<String, Integer> SPECIAL_KEYS = new HashMap<>();

    static {
        SPECIAL_KEYS.put("Escape", 0x1B);
        SPECIAL_KEYS.put("Enter", 0x0D);
        SPECIAL_KEYS.put("Backspace", 0x08);
        SPECIAL_KEYS.put("Tab", 0x09);
        SPECIAL_KEYS.put("Delete", 0x2E);
        SPECIAL_KEYS.put("ArrowUp", 0x26);
        SPECIAL_KEYS.put("ArrowDown", 0x28);
        SPECIAL_KEYS.put("ArrowLeft", 0x25);
        SPECIAL_KEYS.put("ArrowRight", 0x27);
        SPECIAL_KEYS.put("Home", 0x24);
        SPECIAL_KEYS.put("End", 0x23);
        SPECIAL_KEYS.put("PageUp", 0x21);
        SPECIAL_KEYS.put("PageDown", 0x22);
        for (int i = 1; i <= 12; i++) {
            SPECIAL_KEYS.put("F" + i, 0x6F + i);
        }
        SPECIAL_KEYS.put("Win", 0x5B);
        SPECIAL_KEYS.put("Ctrl", 0x11);
        SPECIAL_KEYS.put("Alt", 0x12);
        SPECIAL_KEYS.put("Shift", 0x10);
    }

    public KeyboardModule(InputAdapter inputAdapter) {
        this.inputAdapter = inputAdapter;
    }

    @Override
    public String id() {
        return "keyboard";
    }

    @Override
    public String displayName() {
        return "Keyboard";
    }

    @Override
    public void onMessage(Session s, String type, JsonNode data) {
        if ("text".equals(type)) {
            String text = data.path("text").asText("");
            if (text.length() > 0 && text.length() <= 100) {
                inputAdapter.typeText(text);
            }
        } else if ("key".equals(type)) {
            String codeStr = data.path("code").asText("");
            boolean ctrl = data.path("ctrl").asBoolean(false);
            boolean alt = data.path("alt").asBoolean(false);
            boolean shift = data.path("shift").asBoolean(false);
            boolean win = data.path("win").asBoolean(false);
            String action = data.path("action").asText("press");

            Integer vk = SPECIAL_KEYS.get(codeStr);
            if (vk == null) return;

            if ("press".equals(action) || "down".equals(action)) {
                if (ctrl) inputAdapter.keyDown(VK_CONTROL);
                if (shift) inputAdapter.keyDown(VK_SHIFT);
                if (alt) inputAdapter.keyDown(VK_MENU);
                if (win) inputAdapter.keyDown(VK_LWIN);
            }

            if ("down".equals(action) || "press".equals(action)) {
                inputAdapter.keyDown(vk);
                getHeldKeys(s).add(vk);
            }
            if ("up".equals(action) || "press".equals(action)) {
                inputAdapter.keyUp(vk);
                getHeldKeys(s).remove(vk);
            }

            if ("press".equals(action) || "up".equals(action)) {
                if (win) inputAdapter.keyUp(VK_LWIN);
                if (alt) inputAdapter.keyUp(VK_MENU);
                if (shift) inputAdapter.keyUp(VK_SHIFT);
                if (ctrl) inputAdapter.keyUp(VK_CONTROL);
            }
        }
    }

    @SuppressWarnings("unchecked")
    private Set<Integer> getHeldKeys(Session s) {
        Set<Integer> held = (Set<Integer>) s.getAttribute("keyboard.held");
        if (held == null) {
            held = new HashSet<>();
            s.setAttribute("keyboard.held", held);
        }
        return held;
    }

    @Override
    public void onClose(Session s) {
        Set<Integer> held = getHeldKeys(s);
        for (Integer vk : held) {
            inputAdapter.keyUp(vk);
        }
        held.clear();
        s.removeAttribute("keyboard.held");
    }
}
