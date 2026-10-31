package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// VIP-2: a program a module holds at its top level stays a program of the
// same type, in an effect block, and the result compiles.
func TestHoldProgramFix(t *testing.T) {
	for _, test := range []struct{ name, source, want string }{
		{"a call", "const p = (n: number): Effect.Effect<number> => Effect.sync(() => n)\nexport const v = p(1)\n",
			"const p = (n: number): number!! => Effect.sync(() => n)\nexport const v = effect { return try p(1) }\n"},
		{"a pipe", "const p = (n: number): Effect.Effect<number> => Effect.sync(() => n)\nexport const v = p(1).pipe(Effect.map((n) => n + 1))\n",
			"const p = (n: number): number!! => Effect.sync(() => n)\nexport const v = effect { return try (p(1) |> Effect.map(%, (n) => n + 1)) }\n"},
		{"a field", "const p = (n: number): Effect.Effect<number> => Effect.sync(() => n)\nexport const o = { v: p(1) }\n",
			"const p = (n: number): number!! => Effect.sync(() => n)\nexport const o = { v: effect { return try p(1) } }\n"},
	} {
		t.Run(test.name, func(t *testing.T) {
			got, result := fixedPipe(t, test.source)
			if got != test.want {
				t.Fatalf("--fix writes\n%s\nwant\n%s\nrefused %+v", got, test.want, result.Refused)
			}
			program, file, _, _ := editorProgram(t, got)
			for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
				if d.Category() == diagnostics.CategoryError {
					t.Errorf("the fixed source reports %s%d: %s", d.Source(), d.Code(), d.String())
				}
			}
			if again, _ := fixedPipe(t, got); again != got {
				t.Errorf("a second run changes it:\n%s", again)
			}
		})
	}
}

// An unannotated helper's return type says what its call is, which its own fix
// writes: this one computes a value, as it did in TypeScript.
func TestHoldProgramLeavesUnannotatedHelpers(t *testing.T) {
	source := "function double(n: number) { return n * 2 }\nexport const v = double(2)\n"
	if got, _ := fixedPipe(t, source); strings.Contains(got, "effect {") {
		t.Fatalf("--fix writes\n%s", got)
	}
}

// A program that a statement runs, or that a plain call reads as a value, has
// no block to stand in.
func TestHoldProgramLeavesRunningCalls(t *testing.T) {
	for _, source := range []string{
		"const p = (n: number): Effect.Effect<number> => Effect.sync(() => n)\np(1)\n",
		"const p = (n: number): Effect.Effect<number> => Effect.sync(() => n)\nconsole.log(p(1))\n",
	} {
		if got, _ := fixedPipe(t, source); strings.Contains(got, "effect {") {
			t.Errorf("--fix writes\n%s", got)
		}
	}
}
