package vibelangfuzz

import (
	"fmt"
	"testing"
)

// VIP-26: a function named main is ordinary; the removed EK1016 entry
// warning is an unknown configuration code. Keep the compiler rejection
// under an active oracle, including after the legacy options table freezes.
func TestVIP26RetiredEntryDiagnosticConfig(t *testing.T) {
	w := NewWorkspace(t)
	for _, severity := range []string{"error", "warning", "off"} {
		t.Run(severity, func(t *testing.T) {
			CheckConfig(t, w, "FuzzConfig",
				fmt.Sprintf(`{"diagnostics":{"EK1016":%q}}`, severity),
				"export function main() { return 1 }\n")
		})
	}
	t.Run("existing warning remains configurable", func(t *testing.T) {
		CheckConfig(t, w, "FuzzConfig",
			`{"diagnostics":{"EK1012":"off"}}`,
			"export function main() { return 1 }\n")
	})
}
