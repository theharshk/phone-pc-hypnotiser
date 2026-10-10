package com.phoneremote.adapter.fake;

import com.phoneremote.adapter.InputAdapter;
import com.phoneremote.adapter.MediaKey;
import com.phoneremote.adapter.MouseButton;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;

@Component
@Profile("test")
public class FakeInputAdapter implements InputAdapter {
    
    public final List<String> calls = new ArrayList<>();
    public int x = 0, y = 0;

    @Override
    public void moveRelative(int dx, int dy) {
        x += dx;
        y += dy;
        calls.add("moveRelative(" + dx + "," + dy + ")");
    }

    @Override
    public void moveAbsolute(int x, int y) {
        this.x = x;
        this.y = y;
        calls.add("moveAbsolute(" + x + "," + y + ")");
    }

    @Override
    public void mouseDown(MouseButton b) {
        calls.add("mouseDown(" + b.name() + ")");
    }

    @Override
    public void mouseUp(MouseButton b) {
        calls.add("mouseUp(" + b.name() + ")");
    }

    @Override
    public void scroll(int amount) {
        calls.add("scroll(" + amount + ")");
    }

    @Override
    public void keyDown(int keyCode) {
        calls.add("keyDown(" + keyCode + ")");
    }

    @Override
    public void keyUp(int keyCode) {
        calls.add("keyUp(" + keyCode + ")");
    }

    @Override
    public void typeText(String text) {
        calls.add("typeText(" + text + ")");
    }

    @Override
    public void mediaKey(MediaKey key) {
        calls.add("mediaKey(" + key.name() + ")");
    }
}
