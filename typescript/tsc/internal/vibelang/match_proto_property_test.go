package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"strings"
	"testing"
)

// VIP-7 retains the pinned MatchProperty literal-__proto__ early error.
func TestMatchProtoPropertyName(t *testing.T) {
	for _, key := range []string{"__proto__", `"__proto__"`, "'__proto__'", `__pr\u006fto__`, `"__pr\u006fto__"`} {
		for _, suffix := range []string{"", ": let value"} {
			for _, source := range []string{
				"function f(x:unknown){return match(x){when {" + key + suffix + "}:1;default:0;}}",
				"function f(x:unknown){return x is {" + key + suffix + "}}",
			} {
				program, file, _, _ := editorProgram(t, source)
				count := 0
				for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
					if d.Category() != diagnostics.CategoryError {
						continue
					}
					count++
					if d.Code() != 707 || d.Source() != "EK" || !strings.Contains(d.String(), `["__proto__"]`) {
						t.Fatalf("%s: %s", source, d.String())
					}
				}
				if count != 1 {
					t.Fatalf("want one EK0707, got %d: %s", count, source)
				}
			}
		}
	}
}
func TestMatchProtoPropertyControls(t *testing.T) {
	for _, source := range []string{
		`function f(x:unknown){return match(x){when {["__proto__"]:let v}:v;default:0;}}`,
		`function f(x:unknown){return x is {["__proto__"]:null}}`,
		`function f(x:unknown){return match(x){when {let __proto__}:__proto__;default:0;}}`,
		`function f(x:unknown){return match(x){when {const __proto__}:__proto__;default:0;}}`,
		`function f(x:unknown){return x is {__proto_}}`,
		`function f(){return {__proto__:null}}`,
	} {
		program, file, _, _ := editorProgram(t, source)
		for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
			if d.Category() == diagnostics.CategoryError {
				t.Fatalf("%s: %s", source, d.String())
			}
		}
	}
}
