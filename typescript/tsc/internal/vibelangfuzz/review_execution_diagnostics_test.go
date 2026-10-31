package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"
)

const reviewExecutionTarget = "FuzzReviewExecutionDiagnostics"
const reviewExecutionSpacingQuote = "As in `new . target`, whitespace, comments and line breaks may separate the tokens of `try.all`, `fork.in`, `fork.scoped` and `fork.detached`: `try . all [a, b]` is `try.all [a, b]`."

type reviewExecutionRule struct {
	key, good, bad, quote string
	code                  int32
}

func reviewExecutionRules() []reviewExecutionRule {
	var rules []reviewExecutionRule
	add := func(key, good, bad, quote string, code int32) {
		rules = append(rules, reviewExecutionRule{key, good, bad, quote, code})
	}
	for _, suffix := range []string{"other", "map", "all"} {
		add("fork-"+suffix, "export effect function run(){ const f = fork.scoped Effect.succeed(1); return 0 }",
			"export effect function run(){ const f = fork."+suffix+" Effect.succeed(1); return 0 }",
			"a "+"`fork.`"+" owner other than "+"`in(s)`"+", "+"`scoped`"+" or "+"`detached`", 1705)
	}
	for index, value := range []string{"1", "\"wrong\"", "false", "{}"} {
		add(fmt.Sprintf("scope-%d", index),
			"export effect function run(s: Scope.Scope){ const f = fork.in(s) Effect.succeed(1); return 0 }",
			"export effect function run(s: Scope.Scope){ const f = fork.in("+value+") Effect.succeed(1); return 0 }",
			"a "+"`fork.in(s)`"+" scope operand not assignable to "+"`Scope.Scope`", 1706)
	}
	for _, suffix := range []string{"map", "fork", "zip"} {
		add("try-"+suffix, "export effect function run(){ return try.all [Effect.succeed(1)] }",
			"export effect function run(){ return try."+suffix+" [Effect.succeed(1)] }",
			"a name after "+"`try.`"+" other than "+"`all`"+", "+"`race`"+", "+"`any`"+" or "+"`allSettled`", 1803)
	}
	for index, value := range []string{"\"fast\"", "false", "{}", "null"} {
		add(fmt.Sprintf("limit-%d", index), "export effect function run(){ for concurrent(2) (const n of [1,2]) { const value = n + 1 }; return 0 }",
			"export effect function run(){ for concurrent("+value+") (const n of [1,2]) { const value = n + 1 }; return 0 }",
			"a "+"`for concurrent`"+" limit not assignable to "+"`Types.Concurrency`", 1907)
	}
	for _, jump := range []string{"return 1", "break", "continue"} {
		add("async-match-"+strings.Fields(jump)[0],
			"export function run(xs: number[]){ for (const x of xs) { const value = async match(x){ when 0: (() => { return 1 })(); default: 0; }; } }",
			"export function run(xs: number[]){ for (const x of xs) { const value = async match(x){ when 0: do { "+jump+" }; default: 0; }; } }",
			"a "+"`return`"+", "+"`break`"+" or "+"`continue`"+" that leaves an "+"`async match`", 706)
	}
	for _, suffix := range []string{"all", "race", "any", "allSettled"} {
		add("retired-await-"+suffix,
			"export async function run():Promise<number[]> {return await Promise.all([Promise.resolve(1)])}",
			"export effect function run(){ return await."+suffix+" [Effect.succeed(1)] }",
			"a retired `await.all`, `await.race`, `await.any` or `await.allSettled`", 1802)
	}
	return rules
}

func TestReviewExecutionDiagnosticsQuoted(t *testing.T) {
	chapter := SpecText("900-appendices.md")
	if !strings.Contains(chapter, reviewExecutionSpacingQuote) {
		t.Fatalf("Appendix B no longer says %q", reviewExecutionSpacingQuote)
	}
	for _, rule := range reviewExecutionRules() {
		prefix := fmt.Sprintf("| "+"`EK%04d`"+" | ", rule.code)
		if !slices.ContainsFunc(strings.Split(chapter, "\n"), func(line string) bool { return strings.HasPrefix(line, prefix) && strings.Contains(line, rule.quote) }) {
			t.Fatalf("Appendix B no longer assigns EK%04d to %q", rule.code, rule.quote)
		}
	}
}

// ASTRA-10: exercise the diagnostic's semantic distinction, not just rejection.
// Good controls preserve ordinary native expressions and nested jump ownership.
func FuzzReviewExecutionDiagnostics(f *testing.F) {
	startShortBudget(f)
	rules := reviewExecutionRules()
	for _, rule := range rules {
		variants := uint8(3)
		if strings.HasPrefix(rule.key, "retired-await-") {
			variants = 2
		}
		for variant := range variants {
			for _, invalid := range []bool{false, true} {
				f.Add(rule.key, variant, invalid)
			}
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, variant uint8, invalid bool) {
		TestReviewExecutionDiagnosticsQuoted(t)
		index := slices.IndexFunc(rules, func(rule reviewExecutionRule) bool { return rule.key == key })
		if index < 0 {
			if key == "" {
				return
			}
			index = int(key[0]) % len(rules)
		}
		rule := rules[index]
		if strings.HasPrefix(rule.key, "retired-await-") {
			variant %= 2 // The token-separation clause names try/fork, not retired await.
		} else {
			variant %= 3
		}
		source := rule.good
		kind := "control"
		if invalid {
			source = rule.bad
			kind = "diagnostic"
		}
		for _, prefix := range []string{"fork", "try", "await"} {
			switch variant {
			case 1:
				source = strings.ReplaceAll(source, prefix+".", prefix+" /* operation */ . ")
			case 2:
				source = strings.ReplaceAll(source, prefix+".", prefix+"\n.\n")
			}
		}
		var result *Result
		var err error
		within(t, "check execution diagnostic", func() { result, err = w.Compile(t.Context(), Single(source+"\n")) })
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		matched := false
		for _, d := range result.Diagnostics {
			if IsEK(d) && d.Code() == rule.code && d.Category().Name() == "error" {
				matched = true
			}
		}
		errors := SortedKeys(Keys(result.Dir, result.Diagnostics))
		gapKey := fmt.Sprintf("%s:%s:%d", kind, rule.key, variant)
		if !invalid && HasError(result.Diagnostics) {
			Gap(t, reviewExecutionTarget, gapKey, "Appendix B's valid repair is rejected with %v\n%s", errors, source)
		}
		if invalid && !matched {
			Gap(t, reviewExecutionTarget, gapKey, "Appendix B requires EK%04d for %q; got %v\n%s", rule.code, rule.quote, errors, source)
		}
		ExpectPending(t, reviewExecutionTarget, gapKey)
		ExpectPending(t, reviewExecutionTarget, specCorpusKey(t))
	})
}
