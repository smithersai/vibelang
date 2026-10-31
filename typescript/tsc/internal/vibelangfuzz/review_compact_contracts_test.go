package vibelangfuzz

import (
	"slices"
	"strings"
	"testing"
)

const reviewCompactContractsTarget = "FuzzReviewCompactContracts"

type reviewCompactContractRule struct{ key, spaced, compact string }

func reviewCompactContractRules() []reviewCompactContractRule {
	var rules []reviewCompactContractRule
	for _, typ := range []struct{ name, typ, value string }{
		{"number", "number", "1"}, {"string", "string", "\"ok\""},
		{"tuple", "readonly [number, string]", "[1, \"a\"] as const"},
		{"alias", "Result", "{ value: 1 }"},
	} {
		head := "import { Effect } from \"effect\"; type Result = { readonly value: number };\n"
		for _, form := range []struct{ name, body string }{
			{"arrow", "export const f = effect (x: " + typ.typ + "): " + typ.typ + "!!{gap}=> x;\n"},
			{"assignment", "const input: " + typ.typ + " = " + typ.value + "; export const program: " + typ.typ + "!!{gap}= Effect.succeed(input);\n"},
			{"equality", "declare const x: " + typ.typ + "!!; declare const y: " + typ.typ + "!!; export const same = x as " + typ.typ + "!!{gap}== y;\n"},
			{"strict-equality", "declare const x: " + typ.typ + "!!; declare const y: " + typ.typ + "!!; export const same = x as " + typ.typ + "!!{gap}=== y;\n"},
		} {
			rules = append(rules, reviewCompactContractRule{form.name + ":" + typ.name, head + strings.ReplaceAll(form.body, "{gap}", " "), head + strings.ReplaceAll(form.body, "{gap}", "")})
		}
	}
	rules = append(rules,
		reviewCompactContractRule{"generic-arrow", "export const f = effect <A>(x: A): A!! => x;\n", "export const f = effect <A>(x: A): A!!=> x;\n"},
		reviewCompactContractRule{"native-not-equal", "export function check(x: number): boolean { return x != 0 }\n", "export function check(x: number): boolean { return x!=0 }\n"},
		reviewCompactContractRule{"native-strict-not-equal", "export function check(x: number): boolean { return x !== 0 }\n", "export function check(x: number): boolean { return x!==0 }\n"},
	)
	return rules
}

func TestReviewCompactContractsQuoted(t *testing.T) {
	b := string(rune(96))
	for _, quote := range []string{"where the next " + b + "!" + b + " completes " + b + "A!!" + b, "Anywhere else " + b + "!=" + b + " and " + b + "!==" + b + " stay equality operators, as in TypeScript:"} {
		if !strings.Contains(SpecText("001-functions.md"), quote) {
			t.Fatalf("Chapter 1 no longer says %q", quote)
		}
	}
	const grammar = "ArrowParams ReturnType? [no LineTerminator here] \"=>\" ConciseBody"
	if !strings.Contains(SpecText("900-appendices.md"), grammar) {
		t.Fatal("Effect arrow grammar no longer admits an adjacent return type and arrow")
	}
}

// OPUS-5: completion of a two-bang contract does not require whitespace
// before the next native assignment, equality or arrow token. The grammar
// bans a line terminator before an arrow, without requiring a space.
// Native inequality controls keep their ordinary unsplit token reading.
func FuzzReviewCompactContracts(f *testing.F) {
	startShortBudget(f)
	rules := reviewCompactContractRules()
	for _, rule := range rules {
		f.Add(rule.key)
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string) {
		TestReviewCompactContractsQuoted(t)
		index := slices.IndexFunc(rules, func(rule reviewCompactContractRule) bool { return rule.key == key })
		if index < 0 {
			if key == "" {
				return
			}
			index = int(key[0]) % len(rules)
		}
		rule := rules[index]
		for _, side := range []struct{ name, text string }{{"spaced", rule.spaced}, {"compact", rule.compact}} {
			var result *Result
			var err error
			within(t, "compile "+side.name+" contract", func() { result, err = w.Compile(t.Context(), Single(side.text)) })
			if err != nil {
				t.Fatal(err)
			}
			errors := SortedKeys(Keys(result.Dir, result.Diagnostics))
			failed := HasError(result.Diagnostics)
			result.Remove()
			if failed && side.name == "spaced" {
				t.Fatalf("invalid spaced control: %v\n%s", errors, side.text)
			}
			if failed {
				Gap(t, reviewCompactContractsTarget, "compact:"+rule.key, "Chapter 1 contract token completion and Appendix A arrow grammar admit adjacent native tokens; spaced form compiles, compact form reports %v\n%s", errors, side.text)
			}
		}
		ExpectPending(t, reviewCompactContractsTarget, "compact:"+rule.key)
		ExpectPending(t, reviewCompactContractsTarget, specCorpusKey(t))
	})
}
