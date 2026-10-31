package vibelangfuzz

import (
	"slices"
	"strconv"
	"strings"
	"testing"
)

const reviewProvideRecoveryTarget = "FuzzReviewProvideRecovery"
const reviewProvideRecoveryQuote = "Relax only those comma-adjacent restrictions for recognition; keep the no-line-break rule after `provide`, the ordinary provider grammar and the final provider's same-line `{`."

type reviewProvideRecoveryRule struct {
	key, source string
	code        int32
}

func reviewProvideRecoveryRules() []reviewProvideRecoveryRule {
	var rules []reviewProvideRecoveryRule
	head := "import { Effect, Layer } from \"effect\";\n"
	add := func(key, providers string, code int32) {
		rules = append(rules, reviewProvideRecoveryRule{key, head + "effect function run() { provide " + providers + " {} return 1 }\n", code})
	}
	for _, count := range []int{2, 3, 4} {
		providers := make([]string, count)
		for i := range providers {
			providers[i] = "Layer.empty"
		}
		for _, separator := range []struct{ name, text string }{
			{"before-lf", "\n,"}, {"after-lf", ",\n"}, {"both-crlf", "\r\n,\r\n"},
			{"before-comment", "/*\n*/,"}, {"after-comment", ",/*\n*/"},
			{"before-ls", "\u2028,"}, {"after-ps", ",\u2029"},
		} {
			add(separator.name+":"+strconv.Itoa(count), strings.Join(providers, separator.text), 1202)
		}
		add("ordinary:"+strconv.Itoa(count), strings.Join(providers, ", "), 0)
		add("inner-call:"+strconv.Itoa(count), "Layer.mergeAll(\n"+strings.Join(providers, ",\n")+"\n), Layer.empty", 0)
		add("inner-array:"+strconv.Itoa(count), "Layer.mergeAll(...[\n"+strings.Join(providers, ",\n")+"\n]), Layer.empty", 0)
	}
	rules = append(rules,
		reviewProvideRecoveryRule{"ordinary-call", "effect function run(provide: (a: number, b: number) => number) { const n = provide(1,\n2); return n }\n", 0},
		reviewProvideRecoveryRule{"ordinary-return", "function run(provide: (a: number, b: number) => number): number { return provide(1,\n2) }\n", 0},
	)
	return rules
}

func TestReviewProvideRecoveryQuoted(t *testing.T) {
	if !strings.Contains(SpecText("005-services.md"), reviewProvideRecoveryQuote) {
		t.Fatalf("Chapter 5 no longer says %q", reviewProvideRecoveryQuote)
	}
	const diagnostic = "a line break immediately before or after a top-level provider-separating"
	if !strings.Contains(SpecText("900-appendices.md"), diagnostic) {
		t.Fatal("Appendix B no longer gives EK1202 its two-sided trigger")
	}
}

// ASTRA-7/detail237: only top-level list-separator breaks are recovered.
// Calls/arrays can contain their own line breaks, and ordinary provide calls
// stay native expressions. LF, CRLF, Unicode line terminators and multiline
// comments exercise the same no-LineTerminator grammar restriction.
func FuzzReviewProvideRecovery(f *testing.F) {
	startShortBudget(f)
	rules := reviewProvideRecoveryRules()
	for _, rule := range rules {
		f.Add(rule.key)
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string) {
		TestReviewProvideRecoveryQuoted(t)
		index := slices.IndexFunc(rules, func(rule reviewProvideRecoveryRule) bool { return rule.key == key })
		if index < 0 {
			if key == "" {
				return
			}
			index = int(key[0]) % len(rules)
		}
		rule := rules[index]
		var result *Result
		var err error
		within(t, "compile provider recovery", func() { result, err = w.Compile(t.Context(), Single(rule.source)) })
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
		gapKey := "recovery:" + rule.key
		if rule.code != 0 && !matched {
			Gap(t, reviewProvideRecoveryTarget, gapKey, "Chapter 5: %q; expected EK1202, got %v\n%s", reviewProvideRecoveryQuote, SortedKeys(Keys(result.Dir, result.Diagnostics)), rule.source)
		}
		if rule.code == 0 && HasError(result.Diagnostics) {
			Gap(t, reviewProvideRecoveryTarget, gapKey, "valid provider/ordinary-call control rejected with %v\n%s", SortedKeys(Keys(result.Dir, result.Diagnostics)), rule.source)
		}
		ExpectPending(t, reviewProvideRecoveryTarget, gapKey)
		ExpectPending(t, reviewProvideRecoveryTarget, specCorpusKey(t))
	})
}
