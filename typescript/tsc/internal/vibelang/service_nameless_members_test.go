package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"strings"
	"testing"
)

// Index signatures and constructors have no Name node, so ordinary contract
// member checks must not silently skip them. Explicit Context.Service classes
// retain their independent migration lint; computed named properties still
// have TypeScript's ordinary behavior.
func TestServiceNamelessMembers(t *testing.T) {
	const source = `export service Indexed { [name: string]: unknown }
export service Constructed { constructor() {} }
export class Ordinary { [name: string]: unknown; constructor(public value: number) {} }
export class Explicit extends Context.Service<Explicit, Record<string, unknown>>()("explicit") {}
export service Named { [Symbol.iterator]: () => IterableIterator<number> }
`
	program, _, _, _ := editorProgram(t, source)
	var got []string
	classLint := 0
	for _, d := range program.GetSemanticDiagnostics(t.Context(), nil) {
		if d.Source() == diagnosticSource {
			switch d.Code() {
			case 902:
				if d.Category() != diagnostics.CategoryError {
					t.Errorf("EK0902 must be an error: %s", d.String())
				}
				got = append(got, source[d.Pos():d.End()])
			case 4831:
				if d.Category() != diagnostics.CategoryWarning {
					t.Errorf("EK4831 must be a warning: %s", d.String())
				}
				classLint++
				if span := source[d.Pos():d.End()]; span != "Explicit" {
					t.Errorf("service-class lint moved from its class name: %q", span)
				}
			default:
				t.Errorf("unexpected VibeLang diagnostic: %s", d.String())
			}
		} else {
			t.Errorf("unexpected TypeScript diagnostic: %s", d.String())
		}
	}
	if classLint != 1 {
		t.Errorf("want one independent EK4831, got %d", classLint)
	}
	if len(got) != 2 || !strings.Contains(got[0], "[name: string]") || !strings.Contains(got[1], "constructor") {
		t.Fatalf("want EK0902 at index signature and constructor, got %q", got)
	}
}
