package com.phoneremote.ws;

import org.springframework.stereotype.Component;
import java.util.concurrent.ConcurrentHashMap;
import java.util.Map;

@Component
public class LockoutTracker {

    private static class StrikeRecord {
        int strikes = 0;
        long lockedUntil = 0;
    }

    private final Map<String, StrikeRecord> records = new ConcurrentHashMap<>();

    public boolean isLockedOut(String key) {
        StrikeRecord record = records.get(key);
        if (record == null) return false;
        return System.currentTimeMillis() < record.lockedUntil;
    }

    public long getLockoutRemaining(String key) {
        StrikeRecord record = records.get(key);
        if (record == null) return 0;
        long remain = record.lockedUntil - System.currentTimeMillis();
        return Math.max(0, remain);
    }

    public void recordStrike(String key) {
        StrikeRecord record = records.computeIfAbsent(key, k -> new StrikeRecord());
        record.strikes++;
        if (record.strikes >= 5) {
            int repeats = record.strikes - 5;
            long lockoutMs = 5 * 60 * 1000L; // 5 min base
            lockoutMs = lockoutMs * (1L << Math.min(repeats, 10)); // double
            long maxLockout = 24 * 60 * 60 * 1000L; // 24 hours
            if (lockoutMs > maxLockout) lockoutMs = maxLockout;
            record.lockedUntil = System.currentTimeMillis() + lockoutMs;
        }
    }

    public void clearStrikes(String key) {
        records.remove(key);
    }

    public void clearAll() {
        records.clear();
    }
}
