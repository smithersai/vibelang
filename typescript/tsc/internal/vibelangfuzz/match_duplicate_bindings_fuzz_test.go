package vibelangfuzz

import (
	"encoding/json"
	"fmt"
	"os"
	"slices"
	"strings"
	"testing"
)

const matchDuplicateBindingsTarget = "FuzzMatchDuplicateBindings"

// Chapter 4 keeps the pinned rule inside one top-level pattern, and only a
// later alternative of an or may replace a cell a failed earlier one set.
const matchDuplicateRuleQuote = "Inside one top-level pattern the pinned duplicate-initialization rule and its `or` exception stay."
const matchDuplicateOrQuote = "A later alternative may replace a cell initialized by a failed earlier alternative of that `or`"
const matchDuplicateRestrictionQuote = "duplicate-initialization restrictions outside that authorized replacement remain"
const matchDuplicatePinnedQuote = "It is a runtime `ReferenceError`\nif more than one of these binding patterns actually execute"

func TestMatchDuplicateBindingsQuoted(t *testing.T) {
	for _, quote := range []string{matchDuplicateRuleQuote, matchDuplicateOrQuote, matchDuplicateRestrictionQuote} {
		if !strings.Contains(SpecText("004-match.md"), quote) {
			t.Fatalf("Chapter 4 no longer says %q; review the duplicate-binding oracle", quote)
		}
	}
	pinned, err := os.ReadFile(SpecPath("../vips/tc39-pattern-matching/explainer.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(pinned), matchDuplicatePinnedQuote) {
		t.Fatalf("the pinned explainer no longer says %q", matchDuplicatePinnedQuote)
	}
}

type matchDuplicateRule struct {
	key, pattern, subject string
	want                  string // the JSON of x, or ReferenceError
}

func matchDuplicateRules() []matchDuplicateRule {
	const thrown = "ReferenceError"
	return []matchDuplicateRule{
		{"list-both", "[let x, let x]", "[1, 2]", thrown},
		{"list-second-absent", "[let x, let x]", "[1]", `"none"`},
		{"and-both", "let x and let x", "3", thrown},
		{"object-both", "{ p: let x, q: let x }", "{ p: 1, q: 2 }", thrown},
		{"object-second-absent", "{ p: let x, q: let x }", "{ p: 1 }", `"none"`},
		{"nested-both", "{ p: { v: let x }, q: let x }", "{ p: { v: 1 }, q: 2 }", thrown},
		{"const-both", "[const x, const x]", "[1, 2]", thrown},
		{"extractor-both", "Option.Some(let x) and let x", "Option.some(1)", thrown},
		{"or-replaces-failed", "[let x and String] or { length: let x }", "[5]", "1"},
		{"or-first-succeeds", "[let x and String] or { length: let x }", `["s"]`, `"s"`},
		{"or-alternatives-only", "[1, let x] or [let x, 1]", "[3, 1]", "3"},
		{"two-ors-both-run", "([9] or [let x]) and ({ k: 9 } or { k: let x })", "Object.assign([4], { k: 6 })", thrown},
		{"two-ors-second-skips", "([9] or [let x]) and ({ k: let x } or { j: 1 })", "Object.assign([4], { j: 1 })", "4"},
		{"after-or-not-replaced", "([let x and 5] or [6]) and let x", "[6]", thrown},
		{"outer-or-replaces", "(([let x and 5] or [6]) and { length: 2 }) or { length: let x }", "[6]", "1"},
		{"or-then-and-live", "([let x] or { y: let x }) and { length: let x }", "[7]", thrown},
	}
}

// matchDuplicateProgram writes the rule in a match arm or in an if head's is,
// each a single top-level pattern.
func matchDuplicateProgram(rule matchDuplicateRule, form uint8) string {
	body := "return match (subject) { when " + rule.pattern + ": x; default: \"none\"; }"
	if form%2 == 1 {
		body = "if (subject is " + rule.pattern + ") { return x } return \"none\""
	}
	imports := ""
	if strings.Contains(rule.pattern+rule.subject, "Option") {
		imports = "import { Option } from \"effect\"\n"
	}
	return imports +
		"function probe(subject: unknown): unknown { " + body + " }\n" +
		"export effect function main() { return probe(" + rule.subject + ") }\n"
}

// FuzzMatchDuplicateBindings runs each rule's pattern and compares the
// result, or the ReferenceError defect, with the pinned rule.
func FuzzMatchDuplicateBindings(f *testing.F) {
	startShortBudget(f)
	rules := matchDuplicateRules()
	for _, rule := range rules {
		f.Add(rule.key, uint8(0))
		f.Add(rule.key, uint8(1))
	}
	w := NewWorkspace(f)
	node, err := NewNode(w.Dir)
	if err != nil {
		f.Fatal(err)
	}
	f.Fuzz(func(t *testing.T, key string, form uint8) {
		TestMatchDuplicateBindingsQuoted(t)
		index := slices.IndexFunc(rules, func(rule matchDuplicateRule) bool { return rule.key == key })
		if index < 0 {
			if key == "" {
				return
			}
			index = int(key[0]) % len(rules)
		}
		rule := rules[index]
		source := matchDuplicateProgram(rule, form)
		gapKey := fmt.Sprintf("%s:%d", rule.key, form%2)
		var result *Result
		var compileErr error
		within(t, "compile duplicate bindings", func() { result, compileErr = w.Compile(t.Context(), Single(source)) })
		if compileErr != nil {
			t.Fatal(compileErr)
		}
		defer result.Remove()
		if HasError(result.Diagnostics) {
			Gap(t, matchDuplicateBindingsTarget, gapKey, "repeated same-keyword bindings are valid at parse time: %v\n%s", SortedKeys(Keys(result.Dir, result.Diagnostics)), source)
			return
		}
		outcome := node.Run(result, "out/main.js", "main")
		got := ""
		switch outcome.Kind {
		case "success":
			var value any
			if json.Unmarshal(outcome.Value, &value) != nil {
				t.Fatalf("invalid outcome %+v", outcome)
			}
			encoded, _ := json.Marshal(value)
			got = string(encoded)
		case "defect":
			got = outcome.Tag
		default:
			t.Fatalf("unexpected outcome %+v\n%s", outcome, source)
		}
		if got != rule.want {
			Gap(t, matchDuplicateBindingsTarget, gapKey, "%s: %s: want %s, got %s\n%s", matchDuplicateRuleQuote, rule.key, rule.want, got, source)
			return
		}
		ExpectPending(t, matchDuplicateBindingsTarget, gapKey)
	})
}
