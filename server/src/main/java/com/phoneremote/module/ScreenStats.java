package com.phoneremote.module;

import java.util.concurrent.ConcurrentLinkedDeque;

public class ScreenStats {
    private static final long WINDOW_MS = 5000;

    public static class FrameStat {
        public long timestamp;
        public long captureMs;
        public long scaleMs;
        public long encodeMs;
        public long frameSizeKB;
        public boolean skipped;
    }

    private final ConcurrentLinkedDeque<FrameStat> window = new ConcurrentLinkedDeque<>();

    public void addStat(long captureMs, long scaleMs, long encodeMs, long frameSizeKB, boolean skipped) {
        FrameStat s = new FrameStat();
        s.timestamp = System.currentTimeMillis();
        s.captureMs = captureMs;
        s.scaleMs = scaleMs;
        s.encodeMs = encodeMs;
        s.frameSizeKB = frameSizeKB;
        s.skipped = skipped;
        window.addLast(s);
        cleanup();
    }

    private void cleanup() {
        long threshold = System.currentTimeMillis() - WINDOW_MS;
        while (!window.isEmpty() && window.peekFirst().timestamp < threshold) {
            window.pollFirst();
        }
    }

    public java.util.List<FrameStat> getRecentFrames(int max) {
        cleanup();
        java.util.List<FrameStat> list = new java.util.ArrayList<>();
        java.util.Iterator<FrameStat> it = window.descendingIterator();
        while (it.hasNext() && list.size() < max) {
            list.add(it.next());
        }
        return list;
    }

    public Averages getAverages() {
        cleanup();
        Averages a = new Averages();
        if (window.isEmpty()) return a;

        long sumCap = 0, sumScale = 0, sumEnc = 0, sumSize = 0;
        int count = 0;

        for (FrameStat s : window) {
            if (s.skipped) {
                a.skippedFrames++;
            } else {
                sumCap += s.captureMs;
                sumScale += s.scaleMs;
                sumEnc += s.encodeMs;
                sumSize += s.frameSizeKB;
                count++;
            }
        }
        
        if (count > 0) {
            a.captureMs = sumCap / count;
            a.scaleMs = sumScale / count;
            a.encodeMs = sumEnc / count;
            a.frameSizeKB = sumSize / count;
            // 5 second window
            a.fps = (int) Math.round((double) count / 5.0);
        }
        return a;
    }

    public static class Averages {
        public long captureMs;
        public long scaleMs;
        public long encodeMs;
        public long frameSizeKB;
        public int fps;
        public int skippedFrames;
    }
}
