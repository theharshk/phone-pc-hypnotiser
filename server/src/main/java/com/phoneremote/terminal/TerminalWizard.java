package com.phoneremote.terminal;

import com.phoneremote.config.ConfigStore;
import org.springframework.boot.CommandLineRunner;
import org.springframework.stereotype.Component;

import java.util.concurrent.CompletableFuture;
import java.util.regex.Pattern;

@Component
public class TerminalWizard implements CommandLineRunner {

    private final ConfigStore configStore;
    private final TerminalPromptService promptService;

    public TerminalWizard(ConfigStore configStore, TerminalPromptService promptService) {
        this.configStore = configStore;
        this.promptService = promptService;
    }

    @Override
    public void run(String... args) throws Exception {
        if (!configStore.isPinSet() && configStore.getDevices().isEmpty()) {
            System.out.println("\n=== Phone Remote First Run ===");
            while (true) {
                CompletableFuture<String> future = promptService.prompt("Set a 6-digit PIN? (recommended) [y/n]:");
                String ans = future.get().toLowerCase();
                if ("y".equals(ans) || "yes".equals(ans)) {
                    while (true) {
                        String pin = promptService.prompt("Enter 6-digit PIN:").get();
                        if (Pattern.matches("^\\d{6}$", pin)) {
                            configStore.setPin(pin);
                            System.out.println("PIN set securely. You will need it to pair your first device.");
                            break;
                        } else {
                            System.out.println("PIN must be exactly 6 digits.");
                        }
                    }
                    break;
                } else if ("n".equals(ans) || "no".equals(ans)) {
                    System.out.println("\nWARNING: No PIN set. Anyone on your local WiFi can request to control your PC.");
                    System.out.println("You will have to approve each device manually from this terminal.\n");
                    break;
                }
            }
            System.out.println("==============================\n");
        }
    }
}
