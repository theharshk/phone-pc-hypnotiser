package com.phoneremote.adapter;

import java.awt.image.BufferedImage;
import java.util.List;

public interface ScreenAdapter {
    List<Object> monitors();
    BufferedImage capture(int monitorIndex);
}
