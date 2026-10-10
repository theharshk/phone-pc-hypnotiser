package com.phoneremote.adapter.fake;

import com.phoneremote.adapter.ScreenAdapter;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;

import java.awt.image.BufferedImage;
import java.util.ArrayList;
import java.util.List;

@Component
@Profile("test")
public class FakeScreenAdapter implements ScreenAdapter {
    public final List<String> calls = new ArrayList<>();

    @Override
    public List<MonitorInfo> monitors() {
        calls.add("monitors()");
        List<MonitorInfo> list = new ArrayList<>();
        list.add(new MonitorInfo(0, new java.awt.Rectangle(0, 0, 1920, 1080)));
        return list;
    }

    @Override
    public BufferedImage capture(int monitorIndex) {
        calls.add("capture(" + monitorIndex + ")");
        return new BufferedImage(1920, 1080, BufferedImage.TYPE_INT_RGB);
    }

    @Override
    public java.awt.Point getCursorPosition() {
        return new java.awt.Point(960, 540);
    }
}
