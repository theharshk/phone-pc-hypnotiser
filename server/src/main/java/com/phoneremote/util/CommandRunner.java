package com.phoneremote.util;

import java.util.List;

public interface CommandRunner {
    int run(List<String> command) throws Exception;
}
