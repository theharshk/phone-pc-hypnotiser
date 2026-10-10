package com.phoneremote.module;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.phoneremote.adapter.InputAdapter;
import com.phoneremote.adapter.MouseButton;
import com.phoneremote.adapter.ScreenAdapter;
import com.phoneremote.ws.Session;
import org.springframework.stereotype.Component;

import javax.imageio.IIOImage;
import javax.imageio.ImageIO;
import javax.imageio.ImageWriteParam;
import javax.imageio.ImageWriter;
import javax.imageio.stream.MemoryCacheImageOutputStream;
import java.awt.*;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import java.util.Iterator;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

@Component
public class ScreenModule implements RemoteModule {

    private static final Logger logger = LoggerFactory.getLogger(ScreenModule.class);
    public static final ScreenStats globalStats = new ScreenStats();

    private final ScreenAdapter screenAdapter;
    private final InputAdapter inputAdapter;
    private final ObjectMapper mapper = new ObjectMapper();

    private final Map<String, StreamContext> activeStreams = new ConcurrentHashMap<>();

    public ScreenModule(ScreenAdapter screenAdapter, InputAdapter inputAdapter) {
        this.screenAdapter = screenAdapter;
        this.inputAdapter = inputAdapter;
    }

    @Override
    public String id() { return "screen"; }

    @Override
    public String displayName() { return "Screen"; }

    @Override
    public void onOpen(Session session) {
        StreamContext ctx = new StreamContext(session);
        activeStreams.put(session.getId(), ctx);
        ctx.start();
    }

    @Override
    public void onClose(Session session) {
        StreamContext ctx = activeStreams.remove(session.getId());
        if (ctx != null) {
            ctx.stop();
        }
    }

    @Override
    public void onMessage(Session session, String type, JsonNode data) {
        StreamContext ctx = activeStreams.get(session.getId());
        if (ctx == null) return;

        if ("ack".equals(type)) {
            // int seq = data.path("seq").asInt();
            ctx.unackedFrames.decrementAndGet();
        } else if ("settings".equals(type)) {
            int q = data.path("quality").asInt(80);
            int s = data.path("scale").asInt(100);
            int f = data.path("fps").asInt(5);
            ctx.quality = Math.max(30, Math.min(90, q));
            ctx.scale = Math.max(25, Math.min(100, s));
            ctx.fps = Math.max(1, Math.min(15, f));
        } else if ("tap".equals(type)) {
            double nx = data.path("x").asDouble();
            double ny = data.path("y").asDouble();
            String btn = data.path("button").asText("left");

            if (nx < 0 || nx > 1 || ny < 0 || ny > 1) return;

            java.util.List<ScreenAdapter.MonitorInfo> monitors = screenAdapter.monitors();
            if (monitors.isEmpty()) return;
            // Assuming monitor 0 for now
            Rectangle bounds = monitors.get(0).bounds;
            int absX = bounds.x + (int) (nx * bounds.width);
            int absY = bounds.y + (int) (ny * bounds.height);

            inputAdapter.moveAbsolute(absX, absY);
            MouseButton mBtn = "right".equals(btn) ? MouseButton.RIGHT : MouseButton.LEFT;
            inputAdapter.mouseDown(mBtn);
            inputAdapter.mouseUp(mBtn);
        }
    }

    private class StreamContext {
        Session session;
        volatile boolean running = false;
        Thread captureThread;
        Thread senderThread;
        Thread cursorThread;

        int quality = 80;
        int scale = 100;
        int fps = 5;

        int sequence = 0;
        AtomicInteger unackedFrames = new AtomicInteger(0);
        ArrayBlockingQueue<byte[]> frameQueue = new ArrayBlockingQueue<>(2);

        public StreamContext(Session session) {
            this.session = session;
        }

        public void start() {
            running = true;

            captureThread = new Thread(() -> {
                ImageWriter writer = null;
                try {
                    Iterator<ImageWriter> writers = ImageIO.getImageWritersByFormatName("jpg");
                    if (writers.hasNext()) writer = writers.next();
                    if (writer == null) return;

                    ImageWriteParam param = writer.getDefaultWriteParam();
                    param.setCompressionMode(ImageWriteParam.MODE_EXPLICIT);

                    while (running) {
                        long start = System.currentTimeMillis();
                        long targetTime = start + (1000 / fps);

                        if (unackedFrames.get() < 2) {
                            java.util.List<ScreenAdapter.MonitorInfo> monitors = screenAdapter.monitors();
                            if (!monitors.isEmpty()) {
                                long capStart = System.currentTimeMillis();
                                BufferedImage img = screenAdapter.capture(0); // monitor 0
                                long capEnd = System.currentTimeMillis();

                                if (img != null) {
                                    int targetW = Math.max(1, (img.getWidth() * scale) / 100);
                                    int targetH = Math.max(1, (img.getHeight() * scale) / 100);
                                    
                                    long scaleStart = System.currentTimeMillis();
                                    BufferedImage scaled = new BufferedImage(targetW, targetH, BufferedImage.TYPE_INT_RGB);
                                    Graphics2D g = scaled.createGraphics();
                                    g.drawImage(img, 0, 0, targetW, targetH, null);
                                    g.dispose();
                                    long scaleEnd = System.currentTimeMillis();

                                    param.setCompressionQuality(quality / 100f);
                                    ByteArrayOutputStream baos = new ByteArrayOutputStream();
                                    MemoryCacheImageOutputStream mos = new MemoryCacheImageOutputStream(baos);
                                    writer.setOutput(mos);
                                    writer.write(null, new IIOImage(scaled, null, null), param);
                                    mos.close();
                                    byte[] jpeg = baos.toByteArray();

                                    long encEnd = System.currentTimeMillis();
                                    
                                    globalStats.addStat(capEnd - capStart, scaleEnd - scaleStart, encEnd - scaleEnd, jpeg.length / 1024, false);
                                    logger.debug("Capture: {}ms, Scale: {}ms, Encode: {}ms, Size: {}KB", (capEnd - capStart), (scaleEnd - scaleStart), (encEnd - scaleEnd), jpeg.length / 1024);

                                    sequence = (sequence + 1) % 65536;

                                    ByteBuffer buf = ByteBuffer.allocate(8 + jpeg.length);
                                    buf.put((byte) 1); // type
                                    buf.put((byte) 0); // monitor index
                                    buf.putShort((short) targetW);
                                    buf.putShort((short) targetH);
                                    buf.putShort((short) sequence);
                                    buf.put(jpeg);

                                    unackedFrames.incrementAndGet();
                                    frameQueue.offer(buf.array());
                                }
                            }
                        } else {
                            globalStats.addStat(0, 0, 0, 0, true);
                        }

                        long sleepTime = targetTime - System.currentTimeMillis();
                        if (sleepTime > 0) Thread.sleep(sleepTime);
                    }
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                } catch (Exception e) {
                    e.printStackTrace();
                } finally {
                    if (writer != null) writer.dispose();
                }
            });
            captureThread.setDaemon(true);
            captureThread.setName("ScreenCapture-" + session.getId());
            captureThread.start();

            senderThread = new Thread(() -> {
                try {
                    while (running) {
                        byte[] frame = frameQueue.take();
                        session.sendBinary(frame);
                    }
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
            });
            senderThread.setDaemon(true);
            senderThread.setName("ScreenSender-" + session.getId());
            senderThread.start();

            cursorThread = new Thread(() -> {
                try {
                    while (running) {
                        java.util.List<ScreenAdapter.MonitorInfo> monitors = screenAdapter.monitors();
                        if (!monitors.isEmpty()) {
                            Rectangle b = monitors.get(0).bounds;
                            Point p = screenAdapter.getCursorPosition();
                            if (p != null) {
                                double nx = (double)(p.x - b.x) / b.width;
                                double ny = (double)(p.y - b.y) / b.height;

                                ObjectNode msg = mapper.createObjectNode();
                                msg.put("m", id());
                                msg.put("t", "cursor");
                                ObjectNode d = mapper.createObjectNode();
                                d.put("x", nx);
                                d.put("y", ny);
                                msg.set("d", d);
                                session.send(mapper.writeValueAsString(msg));
                            }
                        }
                        Thread.sleep(200); // 5 Hz
                    }
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                } catch (Exception e) {
                }
            });
            cursorThread.setDaemon(true);
            cursorThread.setName("CursorSender-" + session.getId());
            cursorThread.start();
        }

        public void stop() {
            running = false;
            if (captureThread != null) captureThread.interrupt();
            if (senderThread != null) senderThread.interrupt();
            if (cursorThread != null) cursorThread.interrupt();
        }
    }
}
