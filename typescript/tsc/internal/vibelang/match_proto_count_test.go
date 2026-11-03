package vibelang

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// Each invalid MatchProperty contributes one EK0707, including optional
// presence keys and independently nested or repeated invalid properties.
func TestMatchProtoDiagnosticCount(t *testing.T) {
	for _, tc := range []struct {
		name, source string
		want         int
	}{
		{"optional-match", `function f(x:unknown){return match(x){when {__proto__?}:1;default:0;}}`, 1},
		{"optional-is", `function f(x:unknown){return x is {"__proto__"?}}`, 1},
		{"escaped-binding", `function f(x:unknown){return match(x){when {"__pr\u006fto__":let a}:a;default:0;}}`, 1},
		{"two-properties", `function f(x:unknown){return match(x){when {__proto__, "__proto__"}:1;default:0;}}`, 2},
		{"nested", `function f(x:unknown){return match(x){when {a:{__proto__}}:1;default:0;}}`, 1},
		{"two-arms", `function f(x:unknown){return match(x){when {__proto__}:1;when {"__proto__"}:2;default:0;}}`, 2},
		{"computed", `function f(x:unknown){return match(x){when {["__proto__"]:null}:1;default:0;}}`, 0},
		{"binding", `function f(x:unknown){return match(x){when {let __proto__}:__proto__;default:0;}}`, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, tc.source)
			count := 0
			for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
				if d.Category() != diagnostics.CategoryError {
					continue
				}
				if d.Source() != "EK" || d.Code() != 707 {
					t.Errorf("unexpected diagnostic: %s", d.String())
					continue
				}
				count++
			}
			if count != tc.want {
				t.Fatalf("EK0707 count = %d, want %d", count, tc.want)
			}
		})
	}
}
