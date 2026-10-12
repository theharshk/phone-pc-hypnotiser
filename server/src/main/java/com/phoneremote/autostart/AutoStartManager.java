package com.phoneremote.autostart;

import com.phoneremote.util.CommandRunner;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.io.File;
import java.util.List;

@Component
public class AutoStartManager {

    private static final Logger logger = LoggerFactory.getLogger(AutoStartManager.class);
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

    public String resolveServerJar() {
        File serverJar = new File(workingDir, "server.jar");
        if (serverJar.exists()) {
            return serverJar.getAbsolutePath();
        }
        File targetJar = new File(workingDir, "target" + File.separator + "server-1.0-SNAPSHOT.jar");
        if (targetJar.exists()) {
            return targetJar.getAbsolutePath();
        }
        File snapshotJar = new File(workingDir, "server-1.0-SNAPSHOT.jar");
        if (snapshotJar.exists()) {
            return snapshotJar.getAbsolutePath();
        }
        return workingDir.endsWith("\\") || workingDir.endsWith("/")
                ? workingDir + "server.jar"
                : workingDir + "\\server.jar";
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
        String serverJar = resolveServerJar();
        String cleanWorkingDir = workingDir.endsWith("\\") || workingDir.endsWith("/")
                ? workingDir.substring(0, workingDir.length() - 1)
                : workingDir;
        return "'" + javawPath + "' '-Duser.dir=" + cleanWorkingDir + "' -jar '" + serverJar + "'";
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
        if (exitCode != 0) {
            logger.error("Failed to enable auto-start, exit code: {}", exitCode);
            return false;
        }
        return true;
    }

    public boolean disableAutoStart() throws Exception {
        int exitCode = commandRunner.run(buildDeleteTaskArgs());
        if (exitCode != 0) {
            logger.error("Failed to disable auto-start, exit code: {}", exitCode);
            return false;
        }
        return true;
    }

    public boolean isAutoStartEnabled() throws Exception {
        int exitCode = commandRunner.run(buildQueryTaskArgs());
        return exitCode == 0;
    }
}
