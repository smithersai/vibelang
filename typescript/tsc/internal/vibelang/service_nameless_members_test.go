package vibelang

import (
	"strings"
	"testing"
)

// Index signatures and constructors have no Name node, so ordinary contract
// member checks must not silently skip them. Explicit Context.Service classes
// and computed named properties still have TypeScript's ordinary behavior.
func TestServiceNamelessMembers(t *testing.T) {
	const source = `export service Indexed { [name: string]: unknown }
export service Constructed { constructor() {} }
export class Ordinary { [name: string]: unknown; constructor(public value: number) {} }
export class Explicit extends Context.Service<Explicit, Record<string, unknown>>()("explicit") {}
export service Named { [Symbol.iterator]: () => IterableIterator<number> }
`
	program, _, _, _ := editorProgram(t, source)
	var got []string
	for _, d := range program.GetSemanticDiagnostics(t.Context(), nil) {
		if d.Source() == diagnosticSource {
			if d.Code() != 902 {
				t.Errorf("unexpected VibeLang diagnostic: %s", d.String())
			}
			got = append(got, source[d.Pos():d.End()])
		} else {
			t.Errorf("unexpected TypeScript diagnostic: %s", d.String())
		}
	}
	if len(got) != 2 || !strings.Contains(got[0], "[name: string]") || !strings.Contains(got[1], "constructor") {
		t.Fatalf("want EK0902 at index signature and constructor, got %q", got)
	}
}
