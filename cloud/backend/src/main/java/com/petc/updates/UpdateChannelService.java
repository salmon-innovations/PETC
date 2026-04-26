package com.petc.updates;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;

@Service
public class UpdateChannelService {

    @Value("${petc.updates.stable-version:0.1.0}")
    private String stableVersion;

    @Value("${petc.updates.stable-url:https://releases.example.com/petc}")
    private String stableBaseUrl;

    public UpdateChannel resolve(String channel) {
        return new UpdateChannel("stable", stableVersion, stableBaseUrl);
    }

    public List<Map<String, String>> allChannels() {
        return List.of(Map.of("channel", "stable", "version", stableVersion));
    }
}
