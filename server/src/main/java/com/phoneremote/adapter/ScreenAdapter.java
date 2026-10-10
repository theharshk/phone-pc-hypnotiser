package com.phoneremote.adapter;

import java.awt.image.BufferedImage;
import java.util.List;
import java.awt.Rectangle;
import java.awt.Point;

public interface ScreenAdapter {
    class MonitorInfo {
        public int index;
        public Rectangle bounds;
        public MonitorInfo(int index, Rectangle bounds) {
            this.index = index;
            this.bounds = bounds;
        }
    }
    List<MonitorInfo> monitors();
    BufferedImage capture(int monitorIndex);
    Point getCursorPosition();
}
