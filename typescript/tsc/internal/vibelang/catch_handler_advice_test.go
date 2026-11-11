package vibelang

import (
	"strings"
	"testing"
)

// Diagnostic examples are the only consumer of handler repair text.
// Preserve comments, grouping and native keyword removal without building edits.
func TestCatchHandlerAdviceText(t *testing.T) {
	for _, tc := range []struct{ handler, want string }{
		{`"fallback"`, `() => "fallback"`},
		{`({ value: 7 })`, `() => ({ value: 7 })`},
		{`async () => 7`, `() => 7`},
		{`(async /* keep */ () => 7)`, `/* keep */ () => 7`},
		{`function* () { return 7 }`, `function () { return 7 }`},
		{`async function* () { return 7 }`, `function () { return 7 }`},
		{`effect { return 7 }`, `effect () => { return 7 }`},
	} {
		t.Run(tc.handler, func(t *testing.T) {
			p, file, _, _ := editorProgram(t, "export effect function recover() { return Effect.fail(0) catch "+tc.handler+" }")
			count := 0
			for _, d := range p.GetSemanticDiagnostics(t.Context(), file) {
				if d.Source() != diagnosticSource || d.Code() != 509 {
					continue
				}
				count++
				if text := diagnosticWithNotes(d); !strings.Contains(text, "Write it as a function literal: "+tc.want+".") {
					t.Errorf("missing handler example %q: %s", tc.want, text)
				}
			}
			if count != 1 {
				t.Fatalf("got %d EK0509 diagnostics, want 1", count)
			}
		})
	}
}

// A missing arrow is owned by the parser. The checker keeps its diagnostics
// independent and does not attach an unreachable mechanical repair.
func TestCatchHandlerMissingArrowDiagnostic(t *testing.T) {
	p, file, _, _ := editorProgram(t, "export effect function recover() { return Effect.fail(0) catch (e) { return 7 } }")
	all := append(p.GetSyntacticDiagnostics(t.Context(), file), p.GetSemanticDiagnostics(t.Context(), file)...)
	count := 0
	for _, d := range all {
		if d.Source() == diagnosticSource && d.Code() == 509 {
			count++
			if strings.Contains(diagnosticWithNotes(d), "Write it as a function literal:") {
				t.Errorf("parser-owned diagnostic has a checker repair: %s", diagnosticWithNotes(d))
			}
		}
	}
	if count != 1 {
		t.Fatalf("got %d EK0509 diagnostics, want 1", count)
	}
}
