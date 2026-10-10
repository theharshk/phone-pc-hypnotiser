package com.phoneremote.adapter;

public interface InputAdapter {
    void moveRelative(int dx, int dy);
    void moveAbsolute(int x, int y);
    void mouseDown(MouseButton b);
    void mouseUp(MouseButton b);
    void scroll(int amount);
    void keyDown(int keyCode);
    void keyUp(int keyCode);
    void typeText(String text);
    void mediaKey(MediaKey key);
}
