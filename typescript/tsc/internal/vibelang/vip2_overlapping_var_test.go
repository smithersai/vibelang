package vibelang

import (
	"slices"
	"strings"
	"testing"
)

// rule-evidence: docs/design/vips/0002-effect-blocks-and-do.md#clarification-overlapping-var-diagnostics
//
// VIP-2's do early errors use their assigned codes instead of the general
// EK0107 for the same var: EK0201 for a final declaration, EK0203 in a
// parameter list, and both when both apply. A nonfinal var outside a
// parameter list stays EK0107, as does every other var: .vibe code admits
// none. tsc stops at syntax errors, so this reads the
// editor's syntactic and semantic diagnostics of one file together.
func TestDoVarDiagnosticsReplaceEK0107(t *testing.T) {
	const source = "export function finalVar() { return do { var a = 1 } }\n" +
		"export function parameterVar(v = do { var b = 1; b }) { return v }\n" +
		"export function finalParameterVar(v = do { var c = 1 }) { return v }\n" +
		"export function nonfinalVar() { return do { var d = 1; d } }\n" +
		"export function plainVar() { var e = 1; return e }\n" +
		"export function loopVar() { for (var f = 0; f < 1; f++) {} return 0 }\n" +
		"var g = 1\n"
	want := map[string][]string{
		"var a": {"EK0201"},
		"var b": {"EK0203"},
		"var c": {"EK0201", "EK0203"},
		"var d": {"EK0107"},
		"var e": {"EK0107"},
		"var f": {"EK0107"},
		"var g": {"EK0107"},
	}
	program, file, _, _ := editorProgram(t, source)
	all := append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...)
	for declaration, codes := range want {
		at := strings.Index(source, declaration)
		var got []string
		for _, d := range all {
			if d.Pos() == at {
				got = append(got, errorCode(d))
			}
		}
		slices.Sort(got)
		if !slices.Equal(got, codes) {
			t.Errorf("%s: got %v, want %v", declaration, got, codes)
		}
	}
}
