package vibelang

import (
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// EK0403's fix bridges a try operand under its try, so the bridged Effect is
// still run where the call stood, and the fixed program compiles clean. The
// same --fix pass also spells Effect.Effect<number> as number!! (EK4833).
func TestTryOperandForeignCallRepair(t *testing.T) {
	for _, row := range []struct{ name, body, want string }{
		{"generic", "return try tagged<Effect.Effect<number>>()", "return try (try "},
		{"any", "return try loose()", "return try (try "},
		{"binding", "const v = try tagged<Effect.Effect<number>>(); return v", "const v = try (try "},
		{"untagged", "return try untagged<Effect.Effect<number>>()", "return try (try Effect.orDie(Effect.try({ try: () => untagged<number!!>(), catch: (e) => e })))"},
	} {
		t.Run(row.name, func(t *testing.T) {
			source := "import { tagged, loose, untagged } from \"./lib.js\"\nexport effect function f() { " + row.body + " }\n"
			_, file, _, _ := requirementIdentityProgram(t, source, map[string]string{"lib.d.ts": tryOperandLibrary})
			result := fixCase(t, filepath.Dir(file.FileName().AsString()))
			if result.Err != nil {
				t.Fatal(result.Err)
			}
			fixed := result.Files[file.FileName()]
			if fixed == nil || len(result.Sites) != 0 {
				t.Fatalf("missing try-operand bridge: %+v", result)
			}
			t.Logf("fixed:\n%s", fixed.Text)
			if !strings.Contains(fixed.Text, row.want) {
				t.Fatalf("unexpected try-operand bridge:\n%s", fixed.Text)
			}
			p, f, _, _ := requirementIdentityProgram(t, fixed.Text, map[string]string{"lib.d.ts": tryOperandLibrary})
			for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), f), p.GetSemanticDiagnostics(t.Context(), f)...) {
				if d.Category() == diagnostics.CategoryError {
					t.Errorf("fixed: %s", d.String())
				}
			}
		})
	}
}
