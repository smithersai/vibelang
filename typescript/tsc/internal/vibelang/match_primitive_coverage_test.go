package vibelang

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"testing"
)

// VIP-7 / detail78: built-in patterns cover nothing. Source narrowing stays native.
func TestPrimitiveBuiltinCoverage(t *testing.T) {
	for _, tc := range []struct{ name, decl, typ string }{
		{"Number", "", "1|2"}, {"String", "", "\"a\"|\"b\""}, {"Boolean", "", "boolean"},
		{"BigInt", "", "1n|2n"}, {"Symbol", "declare const marker:unique symbol;", "typeof marker"},
	} {
		for _, pattern := range []string{tc.name, tc.name + "(let item)"} {
			t.Run(pattern, func(t *testing.T) {
				source := tc.decl + "function f(x:" + tc.typ + ") { return match(x) { when " + pattern + ":1; } }"
				program, file, _, _ := editorProgram(t, source)
				var got []string
				for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
					if d.Category() != diagnostics.CategoryError {
						continue
					}
					prefix := d.Source()
					if prefix == "" {
						prefix = "TS"
					}
					got = append(got, fmt.Sprintf("%s%04d", prefix, d.Code()))
				}
				if len(got) != 1 || got[0] != "EK4701" {
					t.Fatalf("codes %v, want [EK4701]\n%s", got, source)
				}
			})
		}
	}
}

func TestPrimitiveBuiltinCoverageControls(t *testing.T) {
	for _, source := range []string{
		"function f(x:1|2) { return match(x) { when Number:1; default:0; } }",
		"function f(x:1|2) { return match(x) { when Number(let item):1; default:0; } }",
		"function f(x:1|2) { return match(x) { when Number:1; when let rest:rest; } }",
		"function f(x:1|2) { return match(x) { when 1:1; when 2:2; } }",
		"function f(x:number) { return match(x) { when Number:1; } }",
		"function f(x:unknown):number { if(x is Number) return x.valueOf(); return 0 }",
		"function f(x:1|2):number { return match(x) { when Number: x.valueOf(); default:x; } }",
		"function f(x:1|2):number { return match(x) { when Number:1; default:do { const left:never=x; 0 }; } }",
	} {
		program, file, _, _ := editorProgram(t, source)
		for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
			if d.Category() == diagnostics.CategoryError {
				t.Fatalf("%s: %s", source, d.String())
			}
		}
	}
}
