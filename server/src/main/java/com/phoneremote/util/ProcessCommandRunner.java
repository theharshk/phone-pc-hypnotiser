package com.phoneremote.util;

import org.springframework.stereotype.Component;

import java.util.List;

@Component
public class ProcessCommandRunner implements CommandRunner {
    @Override
    public int run(List<String> command) throws Exception {
        ProcessBuilder pb = new ProcessBuilder(command);
        Process process = pb.start();
        return process.waitFor();
    }
}
