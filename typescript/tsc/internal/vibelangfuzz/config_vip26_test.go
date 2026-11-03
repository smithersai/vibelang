package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// VIP-26: main is ordinary; the removed EK1016 and EK4843 entry
// warnings are unknown configuration codes. Keep the compiler rejection
// under an active oracle, including both current settings and direct legacy-key controls.
func TestVIP26RetiredEntryDiagnosticConfig(t *testing.T) {
	w := NewWorkspace(t)
	for _, code := range []string{"EK1016", "EK4843"} {
		for _, severity := range Facts().Severities {
			t.Run(code+"/"+severity, func(t *testing.T) {
				CheckConfig(t, w, "FuzzConfig",
					fmt.Sprintf(`{"severities":{%q:%q}}`, code, severity),
					"export const main = () => 1\n")
			})
		}
	}
	t.Run("existing warning remains configurable", func(t *testing.T) {
		CheckConfig(t, w, "FuzzConfig",
			`{"severities":{"EK0801":"off"}}`,
			"export function main() { return 1 }\n")
	})
	t.Run("legacy keys", func(t *testing.T) {
		for _, code := range []string{"EK1016", "EK4843", "EK1012"} {
			for _, placement := range []string{"top", "compilerOptions"} {
				p := configProject("export function main() { return 1 }\n", "", configPlacement(0))
				legacy := fmt.Sprintf(`"vibelang":{"diagnostics":{%q:"off"}}`, code)
				if placement == "top" {
					p.Config = p.Config[:len(p.Config)-1] + "," + legacy + "}"
				} else {
					p.Config = strings.Replace(p.Config, `"compilerOptions": {`, `"compilerOptions": {`+legacy+",", 1)
				}
				c, err := w.CompileOrdered(t.Context(), p, OrderTsc, true)
				if err != nil {
					t.Fatal(err)
				}
				t.Cleanup(c.Remove)
				rejected := false
				for _, d := range c.Diagnostics {
					if d.Category() == diagnostics.CategoryError && isConfigDiagnostic(d) {
						rejected = true
					}
				}
				if rejected != (code != "EK1012") {
					t.Errorf("%s %s: rejected=%v, want %v", placement, code, rejected, code != "EK1012")
				}
			}
		}
	})
}
