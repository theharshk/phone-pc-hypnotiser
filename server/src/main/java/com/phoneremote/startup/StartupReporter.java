package com.phoneremote.startup;

import com.phoneremote.util.NetworkUtil;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.ApplicationListener;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;

import java.io.PrintStream;

@Component
public class StartupReporter implements ApplicationListener<ApplicationReadyEvent> {

    private final Environment environment;

    public StartupReporter(Environment environment) {
        this.environment = environment;
    }

    public static void printStartupAddresses(String ip, int port, PrintStream out) {
        out.println("Phone address: http://" + ip + ":" + port);
        out.println("Admin address: http://localhost:" + port + "/admin");
    }

    @Override
    public void onApplicationEvent(ApplicationReadyEvent event) {
        String portStr = environment.getProperty("local.server.port", environment.getProperty("server.port", "8080"));
        int port = 8080;
        try {
            port = Integer.parseInt(portStr);
        } catch (NumberFormatException ignored) {}

        String ip = NetworkUtil.getLocalIpAddress();
        printStartupAddresses(ip, port, System.out);
    }
}
