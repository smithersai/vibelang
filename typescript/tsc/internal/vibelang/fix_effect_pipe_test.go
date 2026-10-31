package vibelang

import (
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// fixedPipe runs vibelang --fix on source and returns what it writes.
func fixedPipe(t *testing.T, source string) (string, *FixResult) {
	t.Helper()
	_, file, _, _ := editorProgram(t, source)
	result := fixCase(t, filepath.Dir(file.FileName().AsString()))
	if fixed := result.Files[file.FileName()]; fixed != nil {
		return fixed.Text, result
	}
	return source, result
}

// VIP-23: a .pipe of an Effect becomes a pipe, a data-first stage takes the
// topic, any other stage is applied to it, and the result compiles.
func TestEffectPipeFix(t *testing.T) {
	for _, test := range []struct{ name, source, want string }{
		{"one line", "const p = (n: number) => Effect.succeed(n)\nexport const f = (n: number) => p(n).pipe(Effect.map((x) => x + 1))\n",
			"const p = (n: number) => Effect.succeed(n)\nexport const f = (n: number) => p(n) |> Effect.map(%, (x) => x + 1)\n"},
		{"on lines, with a trailing comma and comments", `const p = (n: number) => Effect.succeed(n)
export const f = (n: number) =>
  p(n).pipe(
    // add one
    Effect.map((x) => x + 1),
    Effect.retry({ times: 2 }), // twice
    Effect.asVoid,
  )
`, `const p = (n: number) => Effect.succeed(n)
export const f = (n: number) =>
  p(n)
    // add one
    |> Effect.map(%, (x) => x + 1)
    |> Effect.retry(%, { times: 2 }) // twice
    |> Effect.asVoid(%)
`},
		{"a stage with no data-first form", "const stage = <A>(e: Effect.Effect<A>) => e\nconst p = (n: number) => Effect.succeed(n)\nexport const f = (n: number) => p(n).pipe(stage)\n",
			"const stage = <A>(e: A!!) => e\nconst p = (n: number) => Effect.succeed(n)\nexport const f = (n: number) => p(n) |> stage(%)\n"},
		{"a pipe of a pipe", "const p = (n: number) => Effect.succeed(n)\nexport const f = (n: number) => p(n).pipe(Effect.map((x) => x + 1)).pipe(Effect.asVoid)\n",
			"const p = (n: number) => Effect.succeed(n)\nexport const f = (n: number) => p(n) |> Effect.map(%, (x) => x + 1) |> Effect.asVoid(%)\n"},
		{"a pipe in a stage", "const p = (n: number) => Effect.succeed(n)\nexport const f = (n: number) => p(n).pipe(Effect.flatMap((x) => p(x).pipe(Effect.asVoid)))\n",
			"const p = (n: number) => Effect.succeed(n)\nexport const f = (n: number) => p(n) |> Effect.flatMap(%, (x) => p(x) |> Effect.asVoid(%))\n"},
		{"a conditional's branches", "const p = (n: number) => Effect.succeed(n)\nexport const f = (n: number) => n > 0 ? p(n).pipe(Effect.asVoid) : p(0).pipe(Effect.asVoid)\n",
			"const p = (n: number) => Effect.succeed(n)\nexport const f = (n: number) => n > 0 ? (p(n) |> Effect.asVoid(%)) : (p(0) |> Effect.asVoid(%))\n"},
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

// A .pipe that carries no Effect keeps its meaning and stays.
func TestEffectPipeLeavesOtherPipes(t *testing.T) {
	for _, source := range []string{
		"export const s = Schema.String.pipe(Schema.minLength(1))\n",
		"export const o = Option.some(1).pipe(Option.map((x) => x + 1))\n",
		"export const t = Stream.make(1).pipe(Stream.map((x) => x + 1))\n",
	} {
		got, result := fixedPipe(t, source)
		if strings.Contains(got, "|>") {
			t.Errorf("--fix writes\n%s\nfrom\n%s\nrefused %+v", got, source, result.Refused)
		}
	}
}

// A .pipe whose punctuation holds a comment, or with a spread stage, has no
// exact rewrite: it stays, and the refusal says why.
func TestEffectPipeRefusals(t *testing.T) {
	for _, test := range []struct{ name, source, why string }{
		{"a comment before the closing parenthesis", "const p = (n: number) => Effect.succeed(n)\nexport const f = (n: number) => p(n).pipe(Effect.asVoid /* done */)\n", "a comment stands before"},
		{"a spread stage", "const p = (n: number) => Effect.succeed(n)\nconst stages = [Effect.asVoid] as const\nexport const f = (n: number) => p(n).pipe(...stages)\n", "a stage is a spread"},
	} {
		t.Run(test.name, func(t *testing.T) {
			got, result := fixedPipe(t, test.source)
			if strings.Contains(got, "|>") {
				t.Fatalf("--fix writes\n%s", got)
			}
			found := false
			for _, refused := range result.Refused {
				found = found || strings.Contains(refused.Error, test.why)
			}
			if !found {
				t.Fatalf("refused %+v, want %q", result.Refused, test.why)
			}
		})
	}
}
