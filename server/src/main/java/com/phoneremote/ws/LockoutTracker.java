package com.phoneremote.ws;

import org.springframework.beans.factory.annotation.Value;
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
    private final TimeSource timeSource;
    private final long baseLockoutMs;
    private final long maxLockoutMs;

    public LockoutTracker() {
        this(TimeSource.SYSTEM, 5 * 60 * 1000L, 24 * 60 * 60 * 1000L);
    }

    public LockoutTracker(
            @Value("${lockout.base-ms:300000}") long baseLockoutMs,
            @Value("${lockout.max-ms:86400000}") long maxLockoutMs) {
        this(TimeSource.SYSTEM, baseLockoutMs, maxLockoutMs);
    }

    public LockoutTracker(TimeSource timeSource, long baseLockoutMs, long maxLockoutMs) {
        this.timeSource = timeSource != null ? timeSource : TimeSource.SYSTEM;
        this.baseLockoutMs = baseLockoutMs;
        this.maxLockoutMs = maxLockoutMs;
    }

    public boolean isLockedOut(String key) {
        StrikeRecord record = records.get(key);
        if (record == null) return false;
        return timeSource.currentTimeMillis() < record.lockedUntil;
    }

    public long getLockoutRemaining(String key) {
        StrikeRecord record = records.get(key);
        if (record == null) return 0;
        long remain = record.lockedUntil - timeSource.currentTimeMillis();
        return Math.max(0, remain);
    }

    public void recordStrike(String key) {
        StrikeRecord record = records.computeIfAbsent(key, k -> new StrikeRecord());
        record.strikes++;
        if (record.strikes >= 5) {
            int repeats = record.strikes - 5;
            long lockoutMs = baseLockoutMs;
            lockoutMs = lockoutMs * (1L << Math.min(repeats, 10)); // double
            if (lockoutMs > maxLockoutMs) lockoutMs = maxLockoutMs;
            record.lockedUntil = timeSource.currentTimeMillis() + lockoutMs;
        }
    }

    public void clearStrikes(String key) {
        records.remove(key);
    }

    public void clearAll() {
        records.clear();
    }
}
