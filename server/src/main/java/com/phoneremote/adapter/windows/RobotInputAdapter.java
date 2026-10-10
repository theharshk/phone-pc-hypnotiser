package com.phoneremote.adapter.windows;

import com.phoneremote.adapter.InputAdapter;
import com.phoneremote.adapter.MediaKey;
import com.phoneremote.adapter.MouseButton;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;

import java.awt.AWTException;
import java.awt.GraphicsEnvironment;
import java.awt.MouseInfo;
import java.awt.Point;
import java.awt.Rectangle;
import java.awt.Robot;
import java.awt.event.InputEvent;

@Component
@Profile("!test")
public class RobotInputAdapter implements InputAdapter {
    private Robot robot;
    private int x = 0;
    private int y = 0;
    private long lastSync = 0;

    public RobotInputAdapter() {
        try {
            robot = new Robot();
            robot.setAutoDelay(0);
            robot.setAutoWaitForIdle(false);
            syncPointer();
        } catch (AWTException e) {
            e.printStackTrace();
        }
    }

    private void syncPointer() {
        long now = System.currentTimeMillis();
        if (now - lastSync > 1000) {
            Point p = MouseInfo.getPointerInfo().getLocation();
            if (p != null) {
                this.x = p.x;
                this.y = p.y;
            }
            this.lastSync = now;
        }
    }

    private Rectangle getScreenBounds() {
        // Union of all screens for clamping
        Rectangle bounds = new Rectangle();
        for (var gd : GraphicsEnvironment.getLocalGraphicsEnvironment().getScreenDevices()) {
            bounds = bounds.union(gd.getDefaultConfiguration().getBounds());
        }
        return bounds;
    }

    @Override
    public void moveRelative(int dx, int dy) {
        if (robot == null) return;
        syncPointer();
        
        Rectangle bounds = getScreenBounds();
        
        this.x += dx;
        this.y += dy;
        
        if (this.x < bounds.x) this.x = bounds.x;
        if (this.y < bounds.y) this.y = bounds.y;
        if (this.x >= bounds.x + bounds.width) this.x = bounds.x + bounds.width - 1;
        if (this.y >= bounds.y + bounds.height) this.y = bounds.y + bounds.height - 1;
        
        robot.mouseMove(this.x, this.y);
    }

    @Override
    public void moveAbsolute(int x, int y) {
        if (robot == null) return;
        Rectangle bounds = getScreenBounds();
        this.x = x;
        this.y = y;
        
        if (this.x < bounds.x) this.x = bounds.x;
        if (this.y < bounds.y) this.y = bounds.y;
        if (this.x >= bounds.x + bounds.width) this.x = bounds.x + bounds.width - 1;
        if (this.y >= bounds.y + bounds.height) this.y = bounds.y + bounds.height - 1;
        
        robot.mouseMove(this.x, this.y);
    }

    private int getButtonMask(MouseButton b) {
        switch (b) {
            case LEFT: return InputEvent.BUTTON1_DOWN_MASK;
            case RIGHT: return InputEvent.BUTTON3_DOWN_MASK;
            case MIDDLE: return InputEvent.BUTTON2_DOWN_MASK;
            default: return 0;
        }
    }

    @Override
    public void mouseDown(MouseButton b) {
        if (robot == null) return;
        robot.mousePress(getButtonMask(b));
    }

    @Override
    public void mouseUp(MouseButton b) {
        if (robot == null) return;
        robot.mouseRelease(getButtonMask(b));
    }

    @Override
    public void scroll(int amount) {
        if (robot == null) return;
        robot.mouseWheel(amount);
    }

    @Override
    public void keyDown(int keyCode) { }

    @Override
    public void keyUp(int keyCode) { }

    @Override
    public void typeText(String text) { }

    @Override
    public void mediaKey(MediaKey key) { }
}
