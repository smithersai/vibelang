package tsoptions_test

import (
	"strings"
	"testing"
)

// VIP-30 lists the supported options. No accepted VIP adds automatic spans;
// tracing is rejected even through the legacy config placements.
func TestAutomaticTracingOptionRejected(t *testing.T) {
	for _, placement := range []string{"vibelang", "compilerOptions"} {
		for _, mode := range []string{"none", "exported", "all"} {
			t.Run(placement+"/"+mode, func(t *testing.T) {
				settings := "{\"tracing\":\"" + mode + "\"}"
				text := "{\"" + placement + "\":" + settings + ",\"files\":[\"main.vibe\"]}"
				if placement == "compilerOptions" {
					text = "{\"compilerOptions\":{\"vibelang\":" + settings + "},\"files\":[\"main.vibe\"]}"
				}
				config := vibeConfig(t, text, "{}")
				if len(config.Errors) != 1 || !strings.Contains(config.Errors[0].String(), "tracing") {
					t.Fatalf("automatic tracing accepted: %s; errors %v", text, config.Errors)
				}
			})
		}
	}
}
