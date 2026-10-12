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
import org.springframework.web.socket.WebSocketHandler;

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

    public static boolean validateOrigin(String origin, String hostHeader) {
        if (origin == null) {
            return true; // Documented rule: missing Origin is allowed for non-browser/direct clients
        }
        try {
            java.net.URI originUri = new java.net.URI(origin);
            if (hostHeader != null) {
                String originAuthority = originUri.getAuthority();
                return hostHeader.equals(originAuthority);
            }
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(remoteSocketHandler, "/ws")
                .addInterceptors(new org.springframework.web.socket.server.HandshakeInterceptor() {
                    @Override
                    public boolean beforeHandshake(org.springframework.http.server.ServerHttpRequest request, org.springframework.http.server.ServerHttpResponse response, WebSocketHandler wsHandler, java.util.Map<String, Object> attributes) {
                        String origin = request.getHeaders().getOrigin();
                        String hostHeader = request.getHeaders().getFirst("Host");
                        return validateOrigin(origin, hostHeader);
                    }
                    @Override
                    public void afterHandshake(org.springframework.http.server.ServerHttpRequest request, org.springframework.http.server.ServerHttpResponse response, WebSocketHandler wsHandler, Exception exception) {}
                });
    }

    @org.springframework.context.annotation.Bean
    public org.springframework.web.socket.server.standard.ServletServerContainerFactoryBean createWebSocketContainer() {
        org.springframework.web.socket.server.standard.ServletServerContainerFactoryBean container = new org.springframework.web.socket.server.standard.ServletServerContainerFactoryBean();
        container.setMaxTextMessageBufferSize(262144);
        container.setMaxBinaryMessageBufferSize(262144);
        return container;
    }
}
