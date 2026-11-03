package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const plainContextualTarget = "FuzzPlainArrowContextualReturn"
const plainContextualQuote = "| plain | `function f() { }`, `() => …` | its result, as in TypeScript | TypeScript |"

// A plain function's body is TypeScript, so the Effect expected of it types
// what it returns as TypeScript does. Smithers control's Health.vibe wrote
// probe: () => Effect.succeed({ activity: "unknown" }) against
// probe: () => Effect.Effect<ProbeReport, unknown>, and the compiler typed the
// body by ProbeReport instead: the literal widened to string, TS2375. The
// oracle compares the compiler with itself: the same source as .ts and as
// .vibe gives the same TypeScript errors, by the row above.
type plainContextualValue struct{ key, expected, value string }

var plainContextualValues = []plainContextualValue{
	{"object", `Effect.Effect<{ readonly k: "a" | "b"; readonly o?: "x" | undefined }, unknown>`, `Effect.succeed({ k: "a", o: "x" })`},
	{"literal", `Effect.Effect<"a" | "b", string>`, `Effect.succeed("a")`},
	{"tuple", `Effect.Effect<readonly [1, "x"]>`, `Effect.succeed([1, "x"])`},
	{"branches", `Effect.Effect<"a" | "b", string>`, `(Date.now() > 0 ? Effect.succeed("a") : Effect.fail("bad"))`},
	{"map", `Effect.Effect<"a" | "b">`, `Effect.map(Effect.void, () => "a")`},
	{"exit", `Exit.Exit<"a" | "b">`, `Exit.succeed("a")`},
	{"mismatch", `Effect.Effect<"a" | "b">`, `Effect.succeed("c")`},
	{"plain-value", `Array<"a" | "b">`, `["a"]`},
}

// The destinations of a plain function; %[1]s is the type expected of what it
// returns, %[2]s what it returns.
var plainContextualDestinations = []struct{ key, source string }{
	{"member", "export const x: { readonly p: () => %[1]s } = { p: () => %[2]s }\n"},
	{"member-parameter", "export const x: { p: (a: number) => %[1]s } = { p: (_a) => %[2]s }\n"},
	{"annotated", "export const x: () => %[1]s = () => %[2]s\n"},
	{"block-body", "export const x: () => %[1]s = () => {\n  return %[2]s\n}\n"},
	{"function-expression", "export const x: () => %[1]s = function () {\n  return %[2]s\n}\n"},
	{"method", "export const x: { p(): %[1]s } = { p() {\n  return %[2]s\n} }\n"},
	{"argument", "declare const take: (f: () => %[1]s) => void\ntake(() => %[2]s)\n"},
	{"element", "export const x: ReadonlyArray<() => %[1]s> = [() => %[2]s]\n"},
	{"factory", "export const x: () => () => %[1]s = () => () => %[2]s\n"},
}

func TestPlainArrowContextualReturnQuoted(t *testing.T) {
	if chapter := SpecText("001-functions.md"); !strings.Contains(chapter, plainContextualQuote) {
		t.Fatalf("Chapter 1 no longer says %q", plainContextualQuote)
	}
}

func plainContextualErrors(t *testing.T, w *Workspace, name, source string) []string {
	t.Helper()
	var result *Result
	var err error
	within(t, "compile", func() { result, err = w.Compile(t.Context(), Project{Files: map[string]string{name: source}}) })
	if err != nil {
		t.Fatal(err)
	}
	defer result.Remove()
	var codes []string
	for _, d := range result.Diagnostics {
		if d.Category() == diagnostics.CategoryError && !IsEK(d) {
			codes = append(codes, plainContextualCode(d))
		}
	}
	slices.Sort(codes)
	return codes
}

func plainContextualCode(d *ast.Diagnostic) string { return fmt.Sprintf("TS%d", d.Code()) }

func checkPlainContextual(t *testing.T, w *Workspace, value, destination int) {
	t.Helper()
	TestPlainArrowContextualReturnQuoted(t)
	v, d := plainContextualValues[value], plainContextualDestinations[destination]
	source := "import { Effect, Exit } from \"effect\"\n" + fmt.Sprintf(d.source, v.expected, v.value)
	typescript := plainContextualErrors(t, w, "main.ts", source)
	vibe := plainContextualErrors(t, w, "main.vibe", source)
	key := "twin:" + d.key + ":" + v.key
	if !slices.Equal(typescript, vibe) {
		Gap(t, plainContextualTarget, key, "Chapter 1: %q; the same plain function gives %v as .ts and %v as .vibe\n%s", plainContextualQuote, typescript, vibe, source)
	}
	ExpectPending(t, plainContextualTarget, key)
	ExpectPending(t, plainContextualTarget, specCorpusKey(t))
}

func FuzzPlainArrowContextualReturn(f *testing.F) {
	startShortBudget(f)
	for i, d := range plainContextualDestinations {
		for j, v := range plainContextualValues {
			// Seeds: every destination and every value, not their product.
			if i == 0 || j == 0 {
				f.Add(d.key, v.key)
			}
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, destination, value string) {
		pick := func(key string, count int, keyOf func(int) string) int {
			for i := range count {
				if keyOf(i) == key {
					return i
				}
			}
			if key == "" {
				return 0
			}
			return int(key[0]) % count
		}
		checkPlainContextual(t, w,
			pick(value, len(plainContextualValues), func(i int) string { return plainContextualValues[i].key }),
			pick(destination, len(plainContextualDestinations), func(i int) string { return plainContextualDestinations[i].key }))
	})
}
