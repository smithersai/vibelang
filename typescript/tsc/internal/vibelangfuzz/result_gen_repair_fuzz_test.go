package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"
)

func TestResultGenRepairQuoted(t *testing.T) {
	if !strings.Contains(SpecText("007-tooling.md"), migrationDeclarationFixQuote) {
		t.Fatalf("chapter 007 no longer says %q", migrationDeclarationFixQuote)
	}
}

// resultGenBodies pairs each key with a generator body and whether plain code
// can say the same thing. A body that stays a generator keeps its EK1002.
var resultGenBodies = map[string]struct {
	body  string
	fixed bool
}{
	"binding":      {"const y = yield* VALUE; return y + 1;", true},
	"discard":      {"yield* VALUE; return 1;", true},
	"return":       {"if (n > 0) return yield* VALUE; return 1;", true},
	"fail":         {"if (n > 0) return yield* Result.fail(\"no\"); return 1;", true},
	"callback":     {"const y = yield* VALUE; return [y].map((x) => x + n)[0]!;", true},
	"for-of-array": {"for (const x of [n]) { yield* VALUE; } return 1;", true},
	"for-of":       {"for (const x of xs) { yield* VALUE; } return 1;", false},
	"try":          {"try { yield* VALUE; } finally { n++; } return 1;", false},
	"nested":       {"return (yield* VALUE) + 1;", false},
	"this":         {"const y = yield* VALUE; return [y].map(() => this)[0];", false},
	"fallthrough":  {"yield* VALUE;", false},
}

// Static oracle, chapter 007: a repair is offered only where a plain body keeps
// Result.gen's evaluation order.
func FuzzResultGenRepair(f *testing.F) {
	startShortBudget(f)
	for key := range resultGenBodies {
		f.Add(key, uint8(0))
		f.Add(key, uint8(1))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, variant uint8) {
		TestResultGenRepairQuoted(t)
		rule, ok := resultGenBodies[key]
		if !ok {
			return
		}
		value := "Result.succeed<number, string>(1)"
		if variant%2 != 0 {
			value = "Result.fail<string, number>(\"e\")"
		}
		source := fmt.Sprintf("export const f = (xs: Iterable<number>, n: number): Result.Result<number, string> => Result.gen(function* () { %s });", strings.ReplaceAll(rule.body, "VALUE", value))
		r, err := w.Compile(t.Context(), Single(source))
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		found := false
		for _, d := range r.Diagnostics {
			if d.Source() == "EK" && d.Code() == 1002 {
				found = true
				if offered := toolsOffersQuickFix(t, w, r, "main.vibe", d); offered != rule.fixed {
					Gap(t, "FuzzResultGenRepair", key, "chapter 007: %q; quick fix offered = %v, want %v: %s", migrationDeclarationFixQuote, offered, rule.fixed, source)
				}
			}
		}
		if !found {
			Gap(t, "FuzzResultGenRepair", key+":diagnostic", "Result.gen fixture must reach EK1002")
		}
	})
}
