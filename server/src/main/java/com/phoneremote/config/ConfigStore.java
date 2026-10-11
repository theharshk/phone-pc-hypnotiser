package com.phoneremote.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.concurrent.locks.ReadWriteLock;
import java.util.concurrent.locks.ReentrantReadWriteLock;

@Component
public class ConfigStore {

    public static class DeviceInfo {
        public String deviceId;
        public String name;
        public String tokenHash;
        public long created;
        public long lastSeen;
        public String lastIp;
        public List<String> layout = new ArrayList<>(List.of("screen", "touchpad", "keyboard", "media", "power"));
        public java.util.Map<String, com.fasterxml.jackson.databind.JsonNode> settings = new java.util.HashMap<>();
    }

    public static class ConfigData {
        public int schemaVersion = 1;
        public String pinHash;
        public List<DeviceInfo> devices = new ArrayList<>();
    }

    private ConfigData config = new ConfigData();
    private final ReadWriteLock lock = new ReentrantReadWriteLock();
    private final Path configPath;
    private final ObjectMapper mapper = new ObjectMapper();
    private final BCryptPasswordEncoder passwordEncoder = new BCryptPasswordEncoder();

    public ConfigStore() {
        this(resolveDefaultConfigPath());
    }

    public ConfigStore(Path configPath) {
        this.configPath = configPath;
        load();
    }

    private static Path resolveDefaultConfigPath() {
        String testDir = System.getProperty("test.config.dir");
        if (testDir != null && !testDir.isEmpty()) {
            return Paths.get(testDir, "config.json");
        }
        String appData = System.getenv("APPDATA");
        if (appData != null && !appData.isEmpty()) {
            return Paths.get(appData, "PhoneRemote", "config.json");
        }
        return Paths.get(System.getProperty("user.dir"), "config.json");
    }

    private void load() {
        lock.writeLock().lock();
        try {
            if (Files.exists(configPath)) {
                config = mapper.readValue(configPath.toFile(), ConfigData.class);
            }
        } catch (IOException e) {
            System.err.println("Failed to load config: " + e.getMessage());
        } finally {
            lock.writeLock().unlock();
        }
    }

    public void save() {
        lock.readLock().lock();
        try {
            Files.createDirectories(configPath.getParent());
            Path tmpPath = configPath.getParent().resolve("config.json.tmp");
            mapper.writeValue(tmpPath.toFile(), config);
            Files.move(tmpPath, configPath, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
        } catch (IOException e) {
            System.err.println("Failed to save config: " + e.getMessage());
        } finally {
            lock.readLock().unlock();
        }
    }

    public boolean hasConfigFile() {
        return Files.exists(configPath);
    }

    public boolean isPinSet() {
        lock.readLock().lock();
        try {
            return config.pinHash != null && !config.pinHash.isEmpty();
        } finally {
            lock.readLock().unlock();
        }
    }

    public void setPin(String pin) {
        lock.writeLock().lock();
        try {
            if (pin == null || pin.isEmpty()) {
                config.pinHash = null;
            } else {
                config.pinHash = passwordEncoder.encode(pin);
            }
            save();
        } finally {
            lock.writeLock().unlock();
        }
    }

    public boolean verifyPin(String pin) {
        lock.readLock().lock();
        try {
            if (config.pinHash == null) return false;
            return passwordEncoder.matches(pin, config.pinHash);
        } finally {
            lock.readLock().unlock();
        }
    }

    public String hashToken(String token) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(token.getBytes());
            return Base64.getEncoder().encodeToString(hash);
        } catch (NoSuchAlgorithmException e) {
            throw new RuntimeException(e);
        }
    }

    public void addDevice(DeviceInfo device) {
        lock.writeLock().lock();
        try {
            config.devices.removeIf(d -> d.deviceId.equals(device.deviceId));
            config.devices.add(device);
            save();
        } finally {
            lock.writeLock().unlock();
        }
    }

    public void removeDevice(String deviceId) {
        lock.writeLock().lock();
        try {
            config.devices.removeIf(d -> d.deviceId.equals(deviceId));
            save();
        } finally {
            lock.writeLock().unlock();
        }
    }

    public DeviceInfo getDevice(String deviceId) {
        lock.readLock().lock();
        try {
            for (DeviceInfo d : config.devices) {
                if (d.deviceId.equals(deviceId)) return d;
            }
            return null;
        } finally {
            lock.readLock().unlock();
        }
    }

    public boolean updateDeviceLayout(String deviceId, List<String> layout) {
        lock.writeLock().lock();
        try {
            for (DeviceInfo d : config.devices) {
                if (d.deviceId.equals(deviceId)) {
                    d.layout = new ArrayList<>(layout);
                    save();
                    return true;
                }
            }
            return false;
        } finally {
            lock.writeLock().unlock();
        }
    }

    public void removeAllDevices() {
        lock.writeLock().lock();
        try {
            config.devices.clear();
            save();
        } finally {
            lock.writeLock().unlock();
        }
    }

    public List<DeviceInfo> getDevices() {
        lock.readLock().lock();
        try {
            return new ArrayList<>(config.devices);
        } finally {
            lock.readLock().unlock();
        }
    }

    public boolean verifyDeviceToken(String deviceId, String tokenRaw, String ip) {
        lock.writeLock().lock();
        try {
            String hash = hashToken(tokenRaw);
            for (DeviceInfo d : config.devices) {
                if (d.deviceId.equals(deviceId)) {
                    if (MessageDigest.isEqual(d.tokenHash.getBytes(), hash.getBytes())) {
                        d.lastSeen = System.currentTimeMillis();
                        d.lastIp = ip;
                        save();
                        return true;
                    }
                }
            }
            return false;
        } finally {
            lock.writeLock().unlock();
        }
    }
}
