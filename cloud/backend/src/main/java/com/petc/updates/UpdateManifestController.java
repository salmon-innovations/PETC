package com.petc.updates;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.Instant;
import java.util.Map;

/**
 * Serves the electron-updater manifest so desktop apps can auto-update.
 *
 * electron-updater (generic provider) GETs /api/updates/latest.yml and
 * /api/updates/{filename} to download the installer.
 *
 * The actual release files live in S3; this controller just serves the
 * latest.yml manifest that points there.
 */
@RestController
@RequestMapping("/api/updates")
public class UpdateManifestController {

    private final UpdateChannelService channelService;

    public UpdateManifestController(UpdateChannelService channelService) {
        this.channelService = channelService;
    }

    /** electron-updater polls this endpoint for the latest version manifest. */
    @GetMapping(value = "/latest.yml", produces = "text/yaml")
    public ResponseEntity<String> latestYml(
            @RequestHeader(value = "X-Center-Key", required = false) String centerKey,
            @RequestParam(value = "channel", defaultValue = "stable") String channel
    ) {
        UpdateChannel ch = channelService.resolve(channel);
        return ResponseEntity.ok(ch.toYml());
    }

    /** Summary endpoint for the operator portal. */
    @GetMapping("/channels")
    public ResponseEntity<Map<String, Object>> channels() {
        return ResponseEntity.ok(Map.of(
                "channels", channelService.allChannels(),
                "ts", Instant.now().toString()
        ));
    }
}
