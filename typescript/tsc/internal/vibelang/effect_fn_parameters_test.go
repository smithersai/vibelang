package vibelang

import (
	"strings"
	"testing"
)

// Opencode's Effect.fn result infers its parameter tuple. Its declaration
// differs from copying a generator's written alias into an ordinary arrow.
func TestOpencodeEffectFnInferredParameters(t *testing.T) {
	for _, tc := range []struct{ name, source, want string }{
		{"readonly alias", "export const cleanup = Effect.fn(\"cleanup\")(function*(files: ReadonlyArray<string>) { return files.length })\n", "files: readonly string[]"},
		{"written readonly", "export const cleanup = Effect.fn(\"cleanup\")(function*(files: readonly string[]) { return files.length })\n", "files: readonly string[]"},
		{"generic readonly alias", "export const cleanup = Effect.fn(function* <T extends string>(files: ReadonlyArray<T>) { return files })\n", "files: readonly T[]"},
		{"optional callback", "export const cleanup = Effect.fn(function* (input?: () => number) { return input })\n", "input?: (() => number) | undefined"},
		{"defaulted callback", "export const cleanup = Effect.fn(function* (input: () => number = () => 1) { return input })\n", "input: (() => number) | undefined = () => 1"},
		{"defaulted object", "export const cleanup = Effect.fn(\"cleanup\")(function* (input: { readonly x?: number } = {}) { return input.x ?? 0 })\n", "| undefined = {}"},
		{"member default", "export const client = { cleanup: Effect.fn(function* (input: number = 1) { return input }) }\n", "input: number | undefined = 1"},
		{"readonly rest", "export const cleanup = Effect.fn(function* (...files: ReadonlyArray<string>) { return files.length })\n", "...files: string[]"},
		{"brand alias", "export const Path = Schema.String.pipe(Schema.brand(\"Path\"))\nexport type Path = typeof Path.Type\nexport const cleanup = Effect.fn(\"cleanup\")(function*(input: Path) { return input })\n", "input: string &"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, ok := effectGenQuickFix(t, tc.source)
			if !ok || !strings.Contains(got, tc.want) {
				t.Fatalf("Effect.fn conversion must preserve inferred parameter declaration %q; got:\n%s", tc.want, got)
			}
		})
	}
}

// An import type qualifies its own member; only its type arguments may use
// implicit names. Counting Brand as a written global makes inferred returns
// import the unrelated root namespace instead of preserving the import type.
func TestWrittenPreludeNamesImportTypes(t *testing.T) {
	for _, tc := range []struct {
		source, name string
		want         bool
	}{
		{"export const f = effect (x: import(\"effect/Brand\").Brand<\"Path\">) => x\n", "Brand", false},
		{"export const f = effect (x: import(\"effect/Effect\").Effect<number, never, Scope.Scope>) => x\n", "Scope", true},
	} {
		program, file, _, _ := editorProgram(t, tc.source)
		c, done := program.GetTypeCheckerForFile(t.Context(), file)
		got := writtenPreludeNames(c, preludeStateOf(c), file)[tc.name]
		done()
		if got != tc.want {
			t.Errorf("%s written=%t, want %t in %s", tc.name, got, tc.want, tc.source)
		}
	}
}
