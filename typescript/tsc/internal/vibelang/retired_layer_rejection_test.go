package vibelang

import (
	"strings"
	"testing"
)

// VIP-9 and VIP-12 admit services and Layer constructors, with no layer declaration.
func TestRetiredLayerDeclarationIsError(t *testing.T) {
	for _, prefix := range []string{"", "export "} {
		for _, body := range []string{"readonly value = 1", "const n = 1; readonly value = n", "effect read() { return 1 }"} {
			source := "service Counter { value?: number; read?: () => number!! }\n" + prefix + "layer Live: Counter { " + body + " }\n"
			found := false
			for _, d := range errorsOf(t, source) {
				if d.Code() == EK2121.Code {
					found = true
					if !strings.Contains(d.String(), "write Layer.effect(Service, effect { ... })") {
						t.Fatalf("no migration advice: %s", d.String())
					}
				}
			}
			if !found {
				t.Fatalf("retired layer did not report error EK2121: %s", source)
			}
		}
	}
}
