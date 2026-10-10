package com.phoneremote.terminal;

import org.springframework.stereotype.Service;
import java.util.Scanner;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.CompletableFuture;

@Service
public class TerminalPromptService {
    
    private static class PromptRequest {
        String prompt;
        CompletableFuture<String> future;
    }
    
    private final BlockingQueue<PromptRequest> queue = new ArrayBlockingQueue<>(100);
    
    public TerminalPromptService() {
        Thread t = new Thread(() -> {
            Scanner scanner = new Scanner(System.in);
            while (true) {
                PromptRequest req = null;
                try {
                    req = queue.take();
                    System.out.print(req.prompt + " ");
                    System.out.flush();
                    if (scanner.hasNextLine()) {
                        req.future.complete(scanner.nextLine().trim());
                    } else {
                        req.future.complete("");
                    }
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    break;
                } catch (Exception e) {
                    if (req != null) req.future.completeExceptionally(e);
                }
            }
        });
        t.setDaemon(true);
        t.setName("TerminalPromptThread");
        t.start();
    }
    
    public CompletableFuture<String> prompt(String promptText) {
        PromptRequest req = new PromptRequest();
        req.prompt = promptText;
        req.future = new CompletableFuture<>();
        queue.offer(req);
        return req.future;
    }
}
