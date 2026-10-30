package vibelang

import (
	"fmt"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// VIP-9 uses interface separators. Admitting commas must not skip the shared
// missing-separator check, including when a property and a method are mixed.
func TestServiceInterfaceSeparators(t *testing.T) {
	for _, members := range [][2]string{
		{"left(): Effect.Effect<number>", "right(): Effect.Effect<string>"},
		{"left: () => Effect.Effect<number>", "right: () => Effect.Effect<string>"},
		{"left: () => Effect.Effect<number>", "right(): Effect.Effect<string>"},
	} {
		for _, separator := range []struct {
			text    string
			missing bool
		}{
			{" ", true}, {" /* gap */ ", true}, {", ", false}, {"; ", false}, {"\n", false},
		} {
			t.Run(fmt.Sprintf("%s/%q", members[0], separator.text), func(t *testing.T) {
				source := "export service S { static readonly key = \"separator/S\"; " + members[0] + separator.text + members[1] + " }\n"
				p, file, _, _ := editorProgram(t, source)
				for _, d := range p.GetSyntacticDiagnostics(t.Context(), file) {
					t.Errorf("unexpected parser error: %s", d.String())
				}
				count := 0
				for _, d := range p.GetSemanticDiagnostics(t.Context(), file) {
					if d.Category() != diagnostics.CategoryError {
						continue
					}
					if d.Code() != 908 {
						t.Errorf("unexpected error: %s", diagnosticWithNotes(d))
						continue
					}
					count++
				}
				want := 0
				if separator.missing {
					want = 1
				}
				if count != want {
					t.Errorf("got %d EK0908, want %d: %s", count, want, source)
				}
			})
		}
	}
}
