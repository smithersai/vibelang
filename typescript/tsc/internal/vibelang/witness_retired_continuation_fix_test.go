package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// rule-evidence: docs/design/src/000-intro.md#retired-continuation-forms | `vibelang --fix` rewrites only local service-shaped uses; a rewrite that can't preserve types, behavior, `Exit` and declaration output refuses at that site.
func TestRetiredContinuationFixRewritesOnlyLocalServiceShapedUses(t *testing.T) {
	const local = "control Ask { ask(x: number): number!! }\nexport effect function probe() {\n  try { return try Ask.ask(4) } handle Ask.ask(x) { return try resume(x + 2) }\n}\n"
	result := fixProjectOf(t, map[string]string{"main.vibe": local})
	got := fixedText(result, "main.vibe")
	if !strings.Contains(strings.Join(strings.Fields(got), " "), "service Ask") || !strings.Contains(got, "provide Ask") || strings.Contains(got, "resume(") || strings.Contains(got, "handle ") {
		t.Fatalf("local service-shaped use not rewritten: %s; refused %+v", got, result.Refused)
	}
	if len(result.Refused) != 0 {
		t.Fatalf("preserving rewrite refused: %+v", result.Refused)
	}
	program, file, _, _ := editorProgram(t, got)
	for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
		if d.Category() == diagnostics.CategoryError {
			t.Fatalf("rewritten source does not check: %s\n%s", d.String(), got)
		}
	}

	for _, test := range []struct {
		name, source string
		line         int
	}{
		// An exported control is in the declaration output; its consumers see the change.
		{"exported", "// public\nexport " + local, 2},
		// The handler observes the continuation's result, which a service cannot return.
		{"continuation result", strings.Replace(local, "return try resume(x + 2)", "const result = try resume(x + 2); return result + 1", 1), 1},
		// abandon ends the handled block's Exit with the handler's value.
		{"abandon", strings.Replace(local, "return try resume(x + 2)", "return try abandon()", 1), 1},
		{"select", "export effect function main() {\n  select { default: return 1 }\n}\n", 2},
	} {
		t.Run(test.name, func(t *testing.T) {
			result := fixProjectOf(t, map[string]string{"main.vibe": test.source})
			if got := fixedText(result, "main.vibe"); got != "" && got != test.source {
				t.Fatalf("unpreserving rewrite written:\n%s", got)
			}
			sited := false
			for _, r := range result.Refused {
				if r.Line == test.line && strings.Contains(r.Error, "No general preserving") {
					sited = true
				}
			}
			if !sited {
				t.Fatalf("no refusal at line %d: %+v", test.line, result.Refused)
			}
		})
	}
}
