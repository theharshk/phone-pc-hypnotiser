package com.phoneremote.adapter.windows;

import com.phoneremote.adapter.ScreenAdapter;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;

import java.awt.AWTException;
import java.awt.GraphicsEnvironment;
import java.awt.MouseInfo;
import java.awt.Point;
import java.awt.Rectangle;
import java.awt.Robot;
import java.awt.image.BufferedImage;
import java.util.ArrayList;
import java.util.List;

@Component
@Profile("!test")
public class WindowsScreenAdapter implements ScreenAdapter {

    private Robot robot;

    public WindowsScreenAdapter() {
        System.setProperty("java.awt.headless", "false");
        try {
            robot = new Robot();
        } catch (AWTException e) {
            e.printStackTrace();
        }
    }

    @Override
    public List<MonitorInfo> monitors() {
        List<MonitorInfo> list = new ArrayList<>();
        java.awt.GraphicsDevice[] devices = GraphicsEnvironment.getLocalGraphicsEnvironment().getScreenDevices();
        for (int i = 0; i < devices.length; i++) {
            list.add(new MonitorInfo(i, devices[i].getDefaultConfiguration().getBounds()));
        }
        return list;
    }

    @Override
    public BufferedImage capture(int monitorIndex) {
        if (robot == null) return null;
        java.awt.GraphicsDevice[] devices = GraphicsEnvironment.getLocalGraphicsEnvironment().getScreenDevices();
        if (monitorIndex < 0 || monitorIndex >= devices.length) return null;
        Rectangle bounds = devices[monitorIndex].getDefaultConfiguration().getBounds();
        return robot.createScreenCapture(bounds);
    }

    @Override
    public Point getCursorPosition() {
        return MouseInfo.getPointerInfo().getLocation();
    }
}
