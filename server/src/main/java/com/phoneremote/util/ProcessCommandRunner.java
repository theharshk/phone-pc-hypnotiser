package com.phoneremote.util;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.io.InputStream;
import java.nio.charset.Charset;
import java.util.List;

@Component
public class ProcessCommandRunner implements CommandRunner {

    private static final Logger logger = LoggerFactory.getLogger(ProcessCommandRunner.class);

    @Override
    public int run(List<String> command) throws Exception {
        ProcessBuilder pb = new ProcessBuilder(command);
        pb.redirectErrorStream(true);
        Process process = pb.start();
        String output;
        try (InputStream is = process.getInputStream()) {
            output = new String(is.readAllBytes(), Charset.defaultCharset());
        }
        try {
            int exitCode = process.waitFor();
            if (exitCode != 0) {
                String trimmed = output.trim();
                if (!trimmed.isEmpty()) {
                    logger.error("Command {} failed with exit code {}: {}", command, exitCode, trimmed);
                } else {
                    logger.error("Command {} failed with exit code {}", command, exitCode);
                }
            }
            return exitCode;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw e;
        }
    }
}
