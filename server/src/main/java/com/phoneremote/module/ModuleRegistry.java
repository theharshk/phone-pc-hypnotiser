package com.phoneremote.module;

import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;

@Component
public class ModuleRegistry {
    private final Map<String, RemoteModule> modules;
    private final List<RemoteModule> moduleList;

    public ModuleRegistry(List<RemoteModule> moduleList) {
        this.moduleList = moduleList;
        this.modules = moduleList.stream()
                .collect(Collectors.toMap(RemoteModule::id, Function.identity()));
    }

    public RemoteModule get(String id) {
        return modules.get(id);
    }

    public List<RemoteModule> getAll() {
        return moduleList;
    }
}
