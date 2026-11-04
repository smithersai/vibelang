package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"
)

// Static binding admission; runtime cell replacement remains covered by the
// existing vip07.or-binding-override-plain differential construct.
func orPatternBindingRules() []dataRule {
	patterns := []string{
		"{ a: let v } or { b: let v }",
		"[let v] or [0, let v]",
		"[let v] or { b: let v }",
		"({ a: let v } and if (true)) or { b: let v }",
		"{ a: [let v] } or { b: { c: let v } }",
		"{ a: const v } or { b: const v }",
		"(not(let v)) or { b: let v }",
	}
	forms := []string{
		"export function f(s: unknown) { return match (s) { when %s: v; default: 0; } }",
		"export function f(s: unknown) { const r = match (s) { when %s: v; default: 0; }; return r }",
		"export function f(s: unknown) { if (s is %s) return v; return 0 }",
		"export function f(s: unknown) { if (!(s is %s)) return 0; return v }",
		"export function f(xs: unknown[]) { for (const s of xs) { if (s is %s) return v; } return 0 }",
	}
	const quote = "An `or` pattern shares one lexical cell for a name bound with the same keyword in its alternatives."
	var rules []dataRule
	for home, form := range forms {
		for shape, pattern := range patterns {
			rules = append(rules, dataRule{
				name:    fmt.Sprintf("or-pattern-binding-%d-%d", home, shape),
				chapter: "004-match.md", quote: quote,
				source: fmt.Sprintf(form, pattern), owner: "impl-hunt-data",
			})
		}
	}
	for home, form := range forms {
		rules = append(rules, dataRule{
			name:    fmt.Sprintf("or-pattern-const-write-%d", home),
			chapter: "004-match.md",
			quote:   "Ordinary TDZ before first initialization, user-facing `const` immutability, and duplicate-initialization restrictions outside that authorized replacement remain.",
			source:  fmt.Sprintf(form, "({ a: const v } or { b: const v }) and if (do { v = 1; true })"),
			code:    "only:TS2588", owner: "impl-hunt-data",
		})
	}
	for home, form := range forms {
		for shape, name := range []string{"v2", "$is1", "$match1", "$extracted3"} {
			source := fmt.Sprintf(form, "{ a: let v } or { b: let v }")
			rules = append(rules, dataRule{
				name:    fmt.Sprintf("or-pattern-name-hygiene-%d-%d", home, shape),
				chapter: "004-match.md", quote: quote,
				source: strings.ReplaceAll(source, " v", " "+name), owner: "impl-hunt-data",
			})
		}
	}
	for home, form := range forms {
		rules = append(rules, dataRule{
			name:    fmt.Sprintf("or-pattern-var-recovery-%d", home),
			chapter: "004-match.md",
			quote:   "Pattern bindings use `let` or `const`; `when var x:` is `EK0107`, as `var` is everywhere in `.vibe`.",
			source:  fmt.Sprintf(form, "{ a: var v } or { b: let v }"),
			code:    "only:EK0107", owner: "impl-hunt-data",
		})
	}
	for home, form := range forms {
		for _, variant := range []struct{ key, pattern, code string }{
			{"not", "not(var v)", "only:EK0107"},
			{"both", "{ a: var v } or { b: var v }", "only:EK0107,EK0107"},
		} {
			rules = append(rules, dataRule{
				name:    fmt.Sprintf("or-pattern-var-recovery-%d-%s", home, variant.key),
				chapter: "004-match.md",
				quote:   "Pattern bindings use `let` or `const`; `when var x:` is `EK0107`, as `var` is everywhere in `.vibe`.",
				source:  fmt.Sprintf(form, variant.pattern),
				code:    variant.code, owner: "impl-hunt-data",
			})
		}
	}
	rules = append(rules, []dataRule{
		{name: "or-pattern-unbraced-for-let", chapter: "004-match.md", quote: "an `is` pattern binding in an unbraced statement body", source: "export function f(xs:unknown[]){for(const s of xs) if(s is {a:let v} or {b:let v}) return 1; return 0}", code: "only:EK0705", owner: "impl-hunt-data"},
		{name: "or-pattern-unbraced-for-const", chapter: "004-match.md", quote: "an `is` pattern binding in an unbraced statement body", source: "export function f(xs:unknown[]){for(const s of xs) if(s is {a:const v} or {b:const v}) return 1; return 0}", code: "only:EK0705", owner: "impl-hunt-data"},
		{name: "or-pattern-unbraced-label", chapter: "004-match.md", quote: "an `is` pattern binding in an unbraced statement body", source: "export function f(xs:unknown[]){for(const s of xs) label: if(s is {a:let v} or {b:let v}) return 1; return 0}", code: "only:EK0705", owner: "impl-hunt-data"},
	}...)
	return rules
}

func TestOrPatternBindingRulesQuoted(t *testing.T) {
	for _, rule := range orPatternBindingRules() {
		if !strings.Contains(SpecText(rule.chapter), rule.quote) {
			t.Errorf("%s: stale quote in %s: %q", rule.name, rule.chapter, rule.quote)
		}
	}
}
