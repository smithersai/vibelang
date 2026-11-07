package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestEffectGenDiscardedPrograms(t *testing.T) {
	for _, test := range []struct{ name, body, want string }{
		{"direct", "Effect.succeed(1); return yield* Effect.succeed(2);", "void Effect.succeed(1)"},
		{"parentheses", "(Effect.succeed(1)); return yield* Effect.succeed(2);", "void (Effect.succeed(1))"},
		{"reference", "const job = Effect.succeed(1); job; return yield* Effect.succeed(2);", "void job;"},
		{"conditional", "const job = Effect.succeed(1); true ? job : Effect.succeed(2); return yield* Effect.succeed(3);", "void (true ? job : Effect.succeed(2))"},
		{"callback", "const values = [1].map(n => { Effect.succeed(n); return n; }); return yield* Effect.succeed(values);", "void Effect.succeed(n)"},
		{"function callback", "const values = [1].map(function(n) { Effect.succeed(n); return n; }); return yield* Effect.succeed(values);", "void Effect.succeed(n)"},
		{"comment", "/* discarded, not run */ Effect.succeed(1); return yield* Effect.succeed(2);", "/* discarded, not run */ void Effect.succeed(1)"},
		{"yielded cold success", "yield* Effect.succeed(Effect.succeed(1)); return yield* Effect.succeed(2);", "void Effect.succeed(1);"},
		{"already explicit", "void Effect.succeed(1); return yield* Effect.succeed(2);", "void Effect.succeed(1)"},
	} {
		t.Run(test.name, func(t *testing.T) {
			source := "export const program = Effect.gen(function* () { " + test.body + " });\n"
			got, ok := effectGenQuickFix(t, source)
			if !ok || !strings.Contains(got, test.want) || strings.Contains(got, "void void") {
				t.Fatalf("discard was not preserved: ok=%v\n%s\nwant %q", ok, got, test.want)
			}
			program, file, _, _ := editorProgram(t, got)
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Category() == diagnostics.CategoryError {
					t.Fatalf("fixed program: %s\n%s", d.String(), got)
				}
			}
		})
	}
}
