package com.phoneremote.adapter.fake;

import com.phoneremote.adapter.PowerAdapter;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;

@Component
@Profile("test")
public class FakePowerAdapter implements PowerAdapter {
    public final List<String> calls = new ArrayList<>();

    @Override
    public void shutdown() { calls.add("shutdown()"); }

    @Override
    public void restart() { calls.add("restart()"); }

    @Override
    public void sleep() { calls.add("sleep()"); }

    @Override
    public void hibernate() { calls.add("hibernate()"); }

    @Override
    public void lock() { calls.add("lock()"); }

    @Override
    public void cancelPending() { calls.add("cancelPending()"); }
}
