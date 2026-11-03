package vibelangfuzz

import (
	"os"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

var effectArrowHeadQuotes = []string{
	"only a parenthesized arrow head may have type parameters or a return annotation.",
	"const f: (x: number) => (number!!) = effect x: number!! => x",
	"const g: (x: number) => (number!!) = effect <T> x => x",
}

func requireEffectArrowHeadQuotes(t testing.TB) {
	t.Helper()
	text, err := os.ReadFile(SpecPath("001-functions.md"))
	if err != nil {
		t.Fatal(err)
	}
	for _, quote := range effectArrowHeadQuotes {
		if !strings.Contains(string(text), quote) {
			t.Fatalf("chapter 001 no longer contains %q", quote)
		}
	}
}

func TestEffectArrowHeadsQuoted(t *testing.T) { requireEffectArrowHeadQuotes(t) }

// The oracle follows VIP-1/detail247: only recognized typed/generic bare
// Effect arrow heads own EK0109. Wrapping that parameter admits the same
// type, generic constraints, body, comments and surrounding source.
func FuzzEffectArrowHeads(f *testing.F) {
	// Spec rule: docs/design/src/001-functions.md#ae3218cb2defac1e
	// Chapter 001: typed/generic bare heads reject; parenthesized heads and ordinary effect calls compile (FuzzEffectArrowHeads).

	// Spec rule: docs/design/src/001-functions.md#3820d49aba907397
	// Chapter 001: typed/generic bare heads reject; parenthesized heads and ordinary effect calls compile (FuzzEffectArrowHeads).

	startShortBudget(f)
	requireEffectArrowHeadQuotes(f)
	heads := map[string][2]string{
		"typed":        {"x: number", "(x: number)"},
		"effect-typed": {"x: number!!", "(x: number!!)"},
		"union":        {"x: number | string", "(x: number | string)"},
		"array":        {"x: readonly number[]", "(x: readonly number[])"},
		"function":     {"x: (n: number) => number", "(x: (n: number) => number)"},
		"optional":     {"x?: number", "(x?: number)"},
		"generic":      {"<T> x: T", "<T> (x: T)"},
		"generic-bare": {"<T> x", "<T> (x)"},
		"constraint":   {"<T extends Array<string>> x: T", "<T extends Array<string>> (x: T)"},
		"function-constraint": {"<T extends (n: number) => number> x: T",
			"<T extends (n: number) => number> (x: T)"},
		"default":               {"<T = number> x: T", "<T = number> (x: T)"},
		"parenthesized":         {"(x: number)", "(x: number)"},
		"generic-parenthesized": {"<T>(x: T)", "<T>(x: T)"},
		"ordinary-call":         {"", ""},
		"generic-call":          {"", ""},
		"ordinary-identifier":   {"", ""},
	}
	for key := range heads {
		f.Add(key, uint8(0))
		f.Add(key, uint8(5))
		f.Add(key, uint8(10))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		head, ok := heads[key]
		if !ok {
			key, head = "typed", heads["typed"]
		}
		gap := []string{" ", "/* head */", "\t"}[mode%3]
		prefix := ""
		if mode&4 != 0 {
			prefix = "const café = '😀';\n"
		}
		declaration := "const value = "
		source := prefix + declaration + "effect" + gap + head[0] + " => x"
		fixed := prefix + declaration + "effect" + gap + head[1] + " => x"
		want := head[0] != head[1]
		switch key {
		case "ordinary-call":
			// A declared plain function: the pre-flip compiler infers every
			// function with a body as effectful, so a top-level call to it
			// would be EK1001 for a reason unrelated to the arrow head.
			source = prefix + "declare function effect(x: number): number; const value = effect(1)"
		case "generic-call":
			source = prefix + "declare function effect<T>(x: T): T; const value = effect<number>(1)"
		case "ordinary-identifier":
			source = prefix + "const value = (effect: number) => effect"
		}
		before := toolsCompile(t, w, "FuzzEffectArrowHeads", map[string]string{"main.vibe": source})
		count := 0
		for _, d := range before.Diagnostics {
			if d.Source() == "EK" && d.Code() == 109 {
				count++
			}
		}
		wantCount := 0
		if want {
			wantCount = 1
		}
		if count != wantCount {
			Gap(t, "FuzzEffectArrowHeads", "effect-arrow-head:"+key, "%s; EK0109 count %d, want %d; diagnostics %v\n%s", effectArrowHeadQuotes[0], count, wantCount, Keys(before.Dir, before.Diagnostics), source)
		}
		if !want && HasError(before.Diagnostics) {
			Gap(t, "FuzzEffectArrowHeads", "effect-arrow-head:control:"+key, "ordinary or parenthesized control rejected: %v\n%s", Keys(before.Dir, before.Diagnostics), source)
		}
		before.Remove()
		if !want {
			return
		}
		after := toolsCompile(t, w, "FuzzEffectArrowHeads", map[string]string{"main.vibe": fixed})
		defer after.Remove()
		keptImplicitAny := false
		for _, d := range after.Diagnostics {
			if d.Category() != diagnostics.CategoryError {
				continue
			}
			if key == "generic-bare" && d.Source() == "" && d.Code() == 7006 {
				keptImplicitAny = true
				continue
			}
			Gap(t, "FuzzEffectArrowHeads", "effect-arrow-head:parenthesized:"+key, "%s; parenthesized counterpart rejected: %v\n%s", effectArrowHeadQuotes[0], Keys(after.Dir, after.Diagnostics), fixed)
		}
		if key == "generic-bare" && !keptImplicitAny {
			Gap(t, "FuzzEffectArrowHeads", "effect-arrow-head:native-implicit-any", "parenthesizing the head suppressed native TS7006\n%s", fixed)
		}
	})
}
