package tsoptions_test

import (
	"fmt"
	"strings"
	"testing"
)

// Chapter007 supports only printed legacy codes; VIP33 uses nonconfigurable
// EK4402 for host values. Obsolete4403 cannot survive an accepted policy map.
func TestVibeLangRetiredClockSeverityCode(t *testing.T) {
	for _, root := range []bool{false, true} {
		t.Run(fmt.Sprintf("root-%t-valid-map", root), func(t *testing.T) {
			text := `{"compilerOptions":{"vibelang":{"diagnostics":{"EK9204":"warning"}}},"files":["main.vibe"]}`
			if root {
				text = `{"vibelang":{"diagnostics":{"EK9204":"warning"}},"files":["main.vibe"]}`
			}
			config := vibeConfig(t, text, "{}")
			options := config.CompilerOptions().VibeLang
			if len(config.Errors) != 0 || options == nil || options.Diagnostics["EK9204"] != "warning" {
				t.Fatalf("valid legacy map rejected: %+v; %v", options, config.Errors)
			}
		})
		for _, severity := range []string{"off", "warning", "error"} {
			t.Run(fmt.Sprintf("root-%t-%s", root, severity), func(t *testing.T) {
				legacy := fmt.Sprintf(`{"diagnostics":{"EK4403":%q,"EK9204":"warning"}}`, severity)
				text := `{"compilerOptions":{"vibelang":` + legacy + `},"files":["main.vibe"]}`
				if root {
					text = `{"vibelang":` + legacy + `,"files":["main.vibe"]}`
				}
				config := vibeConfig(t, text, "{}")
				found := false
				for _, d := range config.Errors {
					if d.Code() == 5023 && strings.Contains(d.String(), "EK4403") {
						found = true
					}
				}
				if !found {
					t.Fatalf("obsolete EK4403 must be rejected, got %v", config.Errors)
				}
				// Legacy validation rejects the whole invalid container.
				// Chapter007's per-entry preservation rule belongs to the modern map.
				if options := config.CompilerOptions().VibeLang; options != nil {
					if _, kept := options.Diagnostics["EK4403"]; kept {
						t.Fatal("obsolete clock setting remained effective")
					}
				}
			})
		}
	}
}
