package com.phoneremote.config;

import com.phoneremote.ws.RemoteSocketHandler;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;

import java.io.File;
import java.nio.file.Paths;
import org.springframework.web.servlet.config.annotation.ViewControllerRegistry;

@Configuration
@EnableWebSocket
public class AppConfig implements WebMvcConfigurer, WebSocketConfigurer {

    private final RemoteSocketHandler remoteSocketHandler;

    public AppConfig(RemoteSocketHandler remoteSocketHandler) {
        this.remoteSocketHandler = remoteSocketHandler;
    }

    @Override
    public void addResourceHandlers(ResourceHandlerRegistry registry) {
        // Handle cases where the working directory is either the project root or the server folder
        File webDir = new File("web");
        if (!webDir.exists()) {
            webDir = new File("../web");
        }
        
        String webPath = webDir.getAbsoluteFile().toURI().toString();
        if (!webPath.endsWith("/")) {
            webPath += "/";
        }
        
        registry.addResourceHandler("/**")
                .addResourceLocations(webPath);
    }

    @Override
    public void addViewControllers(ViewControllerRegistry registry) {
        // Forward the root URL to index.html
        registry.addViewController("/").setViewName("forward:/index.html");
    }

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(remoteSocketHandler, "/ws").setAllowedOrigins("*");
    }
}
