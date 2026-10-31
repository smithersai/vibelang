package vibelangfuzz

import (
	"slices"
	"strings"
	"testing"
)

const reviewCallableNamesTarget = "FuzzReviewCallableNames"
const reviewCallableNamesQuote = "`fork` and `join` are reserved words, as `await` is under `[+Await]` (VIP-17, amended)."

type reviewCallableNameRule struct {
	key, source string
	reject      bool
}

func reviewCallableNameRules() []reviewCallableNameRule {
	var rules []reviewCallableNameRule
	for _, name := range []string{"fork", "join"} {
		for _, producer := range []bool{false, true} {
			star, body, kind := "", "return 1", "function"
			if producer {
				star, body, kind = "*", "yield 1", "producer"
			}
			add := func(form, source string, reject bool) {
				rules = append(rules, reviewCallableNameRule{kind + ":" + form + ":" + name, source + "\n", reject})
			}
			add("expression", "export const item = effect function"+star+" "+name+"() { "+body+" }", true)
			add("repaired-expression", "export const item = effect function"+star+" "+name+"One() { "+body+" }", false)
			add("declaration", "export effect function"+star+" "+name+"() { "+body+" }", false)
			add("nested-declaration", "effect function outer() { effect function"+star+" "+name+"() { "+body+" }; return 1 }", true)
			add("object-method", "export const item = { effect "+star+name+"() { "+body+" } }", false)
			add("class-method", "export class Item { effect "+star+name+"() { "+body+" } }", false)
		}
		rules = append(rules, reviewCallableNameRule{name + ":plain-expression-reset", "effect function outer() { const item = function " + name + "() { return 1 }; return 1 }\n", false})
	}
	return rules
}

func TestReviewCallableNamesQuoted(t *testing.T) {
	if !strings.Contains(SpecText("900-appendices.md"), reviewCallableNamesQuote) {
		t.Fatalf("Appendix A no longer says %q", reviewCallableNamesQuote)
	}
	const quote = "Where a VIP is silent, its TypeScript or pinned TC39 counterpart applies."
	if !strings.Contains(SpecText("000-intro.md"), quote) {
		t.Fatalf("Chapter 0 no longer says %q", quote)
	}
}

// ASTRA-6 and decided detail 242: expression names use the callable's own
// context; declaration names use the enclosing context. Property names never
// receive the BindingIdentifier reservation. Plain expressions reset it.
// These expectations follow the specified async counterpart, not current emit.
func FuzzReviewCallableNames(f *testing.F) {
	startShortBudget(f)
	rules := reviewCallableNameRules()
	for _, rule := range rules {
		f.Add(rule.key)
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string) {
		TestReviewCallableNamesQuoted(t)
		index := slices.IndexFunc(rules, func(rule reviewCallableNameRule) bool { return rule.key == key })
		if index < 0 {
			if key == "" {
				return
			}
			index = int(key[0]) % len(rules)
		}
		rule := rules[index]
		var result *Result
		var err error
		within(t, "compile callable name", func() { result, err = w.Compile(t.Context(), Single(rule.source)) })
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		reserved := false
		for _, diagnostic := range result.Diagnostics {
			if IsEK(diagnostic) && diagnostic.Code() == 1702 && diagnostic.Category().Name() == "error" {
				reserved = true
			}
		}
		gapKey := "name:" + rule.key
		if rule.reject && !reserved {
			Gap(t, reviewCallableNamesTarget, gapKey, "Appendix A: %q; detail 242 requires EK1702 for this binding name, got %v\n%s", reviewCallableNamesQuote, SortedKeys(Keys(result.Dir, result.Diagnostics)), rule.source)
		}
		if !rule.reject && HasError(result.Diagnostics) {
			Gap(t, reviewCallableNamesTarget, gapKey, "valid name control rejected with %v\n%s", SortedKeys(Keys(result.Dir, result.Diagnostics)), rule.source)
		}
		ExpectPending(t, reviewCallableNamesTarget, gapKey)
		ExpectPending(t, reviewCallableNamesTarget, specCorpusKey(t))
	})
}
