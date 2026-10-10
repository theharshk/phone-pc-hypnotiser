package com.phoneremote.adapter.windows;

import com.phoneremote.adapter.PowerAdapter;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;

import java.io.IOException;

@Component
@Profile("!test")
public class WindowsPowerAdapter implements PowerAdapter {

    private void runCmd(String... cmd) {
        try {
            new ProcessBuilder(cmd).start();
        } catch (IOException e) {
            System.err.println("Failed to execute power command.");
        }
    }

    @Override
    public void shutdown() {
        runCmd("shutdown", "/s", "/t", "0");
    }

    @Override
    public void restart() {
        runCmd("shutdown", "/r", "/t", "0");
    }

    @Override
    public void sleep() {
        runCmd("rundll32.exe", "powrprof.dll,SetSuspendState", "0,1,0");
    }

    @Override
    public void hibernate() {
        runCmd("shutdown", "/h");
    }

    @Override
    public void lock() {
        runCmd("rundll32.exe", "user32.dll,LockWorkStation");
    }

    @Override
    public void delayedShutdown(int seconds) {
        if (seconds >= 10 && seconds <= 3600) {
            runCmd("shutdown", "/s", "/t", String.valueOf(seconds));
        }
    }

    @Override
    public void cancelPending() {
        runCmd("shutdown", "/a");
    }
}
