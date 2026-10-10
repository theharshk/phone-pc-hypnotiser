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
    public List<Object> monitors() {
        calls.add("monitors()");
        return new ArrayList<>();
    }

    @Override
    public BufferedImage capture(int monitorIndex) {
        calls.add("capture(" + monitorIndex + ")");
        return new BufferedImage(10, 10, BufferedImage.TYPE_INT_RGB);
    }
}
