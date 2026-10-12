package com.phoneremote.module.impl;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.phoneremote.adapter.InputAdapter;
import com.phoneremote.module.RemoteModule;
import com.phoneremote.ws.Session;
import org.springframework.stereotype.Component;

import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;

@Component
public class KeyboardModule implements RemoteModule {

    private final InputAdapter inputAdapter;
    private final ObjectMapper mapper = new ObjectMapper();
    private final ExecutorService streamExecutor = Executors.newSingleThreadExecutor();
    private volatile Future<?> currentStreamFuture = null;
    private volatile AtomicBoolean activeStreamCancelToken = null;

    private static final int VK_CONTROL = 0x11;
    private static final int VK_MENU = 0x12; // Alt
    private static final int VK_SHIFT = 0x10;
    private static final int VK_LWIN = 0x5B;
    private static final int VK_RETURN = 0x0D;
    private static final int VK_TAB = 0x09;

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
        if ("stream_text".equals(type)) {
            String text = data.path("text").asText("");
            int rawDelay = data.path("delayMs").asInt(5);
            int delayMs = Math.max(1, Math.min(1000, rawDelay));
            if (!text.isEmpty()) {
                if (activeStreamCancelToken != null) {
                    activeStreamCancelToken.set(true);
                }
                if (currentStreamFuture != null && !currentStreamFuture.isDone()) {
                    currentStreamFuture.cancel(true);
                }
                AtomicBoolean cancelToken = new AtomicBoolean(false);
                activeStreamCancelToken = cancelToken;
                currentStreamFuture = streamExecutor.submit(() -> {
                    try {
                        doStreamText(s, text, cancelToken, delayMs);
                    } finally {
                        if (!cancelToken.get() && s != null && s.isOpen()) {
                            ObjectNode done = mapper.createObjectNode();
                            done.put("m", "keyboard");
                            done.put("t", "stream_done");
                            try {
                                s.send(mapper.writeValueAsString(done));
                            } catch (Exception ignored) {}
                        }
                    }
                });
            }
        } else if ("cancel_stream".equals(type)) {
            if (activeStreamCancelToken != null) {
                activeStreamCancelToken.set(true);
            }
            if (currentStreamFuture != null) {
                currentStreamFuture.cancel(true);
            }
        } else if ("text".equals(type)) {
            String text = data.path("text").asText("");
            if (!text.isEmpty()) {
                String[] lines = text.split("\r\n|\r|\n", -1);
                for (int i = 0; i < lines.length; i++) {
                    if (!lines[i].isEmpty()) {
                        inputAdapter.typeText(lines[i]);
                    }
                    if (i < lines.length - 1) {
                        inputAdapter.keyDown(VK_RETURN);
                        inputAdapter.keyUp(VK_RETURN);
                    }
                }
            }
        } else if ("key".equals(type)) {
            String codeStr = data.path("code").asText("");
            boolean ctrl = data.path("ctrl").asBoolean(false);
            boolean alt = data.path("alt").asBoolean(false);
            boolean shift = data.path("shift").asBoolean(false);
            boolean win = data.path("win").asBoolean(false);
            String action = data.path("action").asText("press");

            Integer vk = SPECIAL_KEYS.get(codeStr);
            if (vk == null && codeStr != null && codeStr.length() == 1) {
                char c = Character.toUpperCase(codeStr.charAt(0));
                if ((c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == ' ') {
                    vk = (int) c;
                }
            }
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

    public void awaitCurrentStream(long timeout, TimeUnit unit) throws Exception {
        if (currentStreamFuture != null) {
            try {
                currentStreamFuture.get(timeout, unit);
            } catch (CancellationException ignored) {
                // Future was cancelled as expected
            }
        }
    }

    private void doStreamText(Session s, String text, AtomicBoolean cancelToken, int delayMs) {
        for (int i = 0; i < text.length(); i++) {
            if (cancelToken.get() || Thread.currentThread().isInterrupted() || (s != null && !s.isOpen())) {
                break;
            }
            char c = text.charAt(i);
            if (c == '\r') {
                continue;
            } else if (c == '\n') {
                inputAdapter.keyDown(VK_RETURN);
                sleepQuietly(20);
                inputAdapter.keyUp(VK_RETURN);
                sleepQuietly(25);
            } else if (c == '\t') {
                inputAdapter.keyDown(VK_TAB);
                sleepQuietly(20);
                inputAdapter.keyUp(VK_TAB);
                sleepQuietly(15);
            } else {
                inputAdapter.typeText(String.valueOf(c));
                sleepQuietly(delayMs);
            }
        }
    }

    private void sleepQuietly(long ms) {
        try {
            Thread.sleep(ms);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    @Override
    public void onClose(Session s) {
        if (activeStreamCancelToken != null) {
            activeStreamCancelToken.set(true);
        }
        if (currentStreamFuture != null) {
            currentStreamFuture.cancel(true);
        }
        Set<Integer> held = getHeldKeys(s);
        for (Integer vk : held) {
            inputAdapter.keyUp(vk);
        }
        held.clear();
        s.removeAttribute("keyboard.held");
    }
}
