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

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(remoteSocketHandler, "/ws")
                .addInterceptors(new org.springframework.web.socket.server.HandshakeInterceptor() {
                    @Override
                    public boolean beforeHandshake(org.springframework.http.server.ServerHttpRequest request, org.springframework.http.server.ServerHttpResponse response, WebSocketHandler wsHandler, java.util.Map<String, Object> attributes) throws Exception {
                        String origin = request.getHeaders().getOrigin();
                        if (origin != null) {
                            java.net.URI originUri = new java.net.URI(origin);
                            String hostHeader = request.getHeaders().getFirst("Host");
                            if (hostHeader != null) {
                                String originAuthority = originUri.getAuthority();
                                if (!hostHeader.equals(originAuthority)) {
                                    return false;
                                }
                            }
                        }
                        return true;
                    }
                    @Override
                    public void afterHandshake(org.springframework.http.server.ServerHttpRequest request, org.springframework.http.server.ServerHttpResponse response, WebSocketHandler wsHandler, Exception exception) {}
                });
    }
}
