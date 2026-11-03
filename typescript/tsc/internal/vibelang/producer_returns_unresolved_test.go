package vibelang

import (
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

// A function* passed to a callee that does not resolve may be the generator
// Effect.gen and Effect.fn take. Until the program resolves, nothing says it
// is a producer, so EK2128 stays silent and --fix keeps its return value. With
// effect not yet installed, --fix wrote `{ x + 1; return }` over the return of
// Effect.fn("load")(function* …), and no later round could recover it.
func TestProducerReturnUnresolvedCalleeKeepsValue(t *testing.T) {
	for _, test := range []struct{ name, source, kept string }{
		{"chained call", `import { Effect } from "effect"
export const load = Effect.fn("load")(function* (x: number) {
  yield* Effect.sleep("1 millis")
  return x + 1
})
`, "return x + 1"},
		{"direct call", `import { Effect } from "effect"
export const load = Effect.gen(function* () {
  return 1
})
`, "return 1"},
		{"unresolved name", `export const load = missing(function* () {
  return 1
})
`, "return 1"},
	} {
		t.Run(test.name, func(t *testing.T) {
			program, file, _, _ := editorProgramWith(t, test.source, map[string]string{})
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Code() == EK2128.Code {
					t.Fatalf("EK2128 on an unresolved callee: %s", d.String())
				}
			}
			result := fixCase(t, filepath.Dir(file.FileName().AsString()))
			if fixed := result.Files[file.FileName()]; fixed != nil && !strings.Contains(fixed.Text, test.kept) {
				t.Fatalf("--fix dropped %q:\n%s", test.kept, fixed.Text)
			}
		})
	}
}

// A callee the program resolves still decides: a function* given to any-typed
// code, or to a parameter that is not a generator, is a producer.
func TestProducerReturnResolvedCalleeStillReports(t *testing.T) {
	for _, source := range []string{
		"declare const take: any\nexport const load = take(function* () {\n  return 1\n})\n",
		"declare function take(f: unknown): void\ntake(function* () {\n  return 1\n})\n",
	} {
		program, file, _, _ := editorProgramWith(t, source, map[string]string{})
		var codes []int32
		for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
			codes = append(codes, d.Code())
		}
		if !slices.Contains(codes, EK2128.Code) {
			t.Fatalf("codes %v; want EK2128 for\n%s", codes, source)
		}
	}
}
