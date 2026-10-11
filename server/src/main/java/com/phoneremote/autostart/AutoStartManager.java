package com.phoneremote.autostart;

import com.phoneremote.util.CommandRunner;
import org.springframework.stereotype.Component;

import java.io.File;
import java.util.List;

@Component
public class AutoStartManager {

    public static final String TASK_NAME = "PhoneRemote";

    private final CommandRunner commandRunner;
    private final String workingDir;

    @org.springframework.beans.factory.annotation.Autowired
    public AutoStartManager(CommandRunner commandRunner) {
        this(commandRunner, System.getProperty("user.dir"));
    }

    public AutoStartManager(CommandRunner commandRunner, String workingDir) {
        this.commandRunner = commandRunner;
        this.workingDir = workingDir;
    }

    public String getWorkingDir() {
        return workingDir;
    }

    public String buildTaskRunCommand() {
        String javaHome = System.getProperty("java.home");
        String javawPath = "javaw";
        if (javaHome != null && !javaHome.isEmpty()) {
            File javawFile = new File(javaHome, "bin/javaw.exe");
            if (javawFile.exists()) {
                javawPath = javawFile.getAbsolutePath();
            }
        }
        return "cmd.exe /c cd /d \"" + workingDir + "\" && \"" + javawPath + "\" -jar server.jar";
    }

    public List<String> buildCreateTaskArgs() {
        return List.of("schtasks", "/Create", "/F", "/TN", TASK_NAME, "/SC", "ONLOGON", "/TR", buildTaskRunCommand());
    }

    public List<String> buildDeleteTaskArgs() {
        return List.of("schtasks", "/Delete", "/F", "/TN", TASK_NAME);
    }

    public List<String> buildQueryTaskArgs() {
        return List.of("schtasks", "/Query", "/TN", TASK_NAME);
    }

    public boolean enableAutoStart() throws Exception {
        int exitCode = commandRunner.run(buildCreateTaskArgs());
        return exitCode == 0;
    }

    public boolean disableAutoStart() throws Exception {
        int exitCode = commandRunner.run(buildDeleteTaskArgs());
        return exitCode == 0;
    }

    public boolean isAutoStartEnabled() throws Exception {
        int exitCode = commandRunner.run(buildQueryTaskArgs());
        return exitCode == 0;
    }
}
