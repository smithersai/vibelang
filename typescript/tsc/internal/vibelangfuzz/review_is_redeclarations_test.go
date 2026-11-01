package vibelangfuzz

import (
	"fmt"
	"os"
	"slices"
	"strings"
	"testing"
)

const reviewIsRedeclarationsTarget = "FuzzReviewIsRedeclarations"
const reviewIsHomeQuote = "In an ordinary block expression or an `if` head, its `let` and `const` names belong to the nearest enclosing lexical block"
const reviewIsBindingQuote = "As with normal binding statements,\nthe bindings introduced by binding patterns\nare established in the nearest block scope"
const reviewIsDuplicateQuote = "within the scope of an entire top-level pattern,\na given name can appear in multiple binding patterns,\nas long as all instances use the same binding type keyword."
const reviewIsRepeatQuote = "repeated binding patterns keep the pinned duplicate-initialization rules and their `or` replacement exception."

func TestReviewIsRedeclarationsQuoted(t *testing.T) {
	for _, quote := range []string{reviewIsHomeQuote, reviewIsRepeatQuote} {
		if !strings.Contains(SpecText("004-match.md"), quote) {
			t.Fatalf("Chapter4 no longer says %q; update the binding-home oracle", quote)
		}
	}
	pinned, err := os.ReadFile(SpecPath("../vips/tc39-pattern-matching/explainer.md"))
	if err != nil {
		t.Fatal(err)
	}
	for _, quote := range []string{reviewIsBindingQuote, reviewIsDuplicateQuote} {
		if !strings.Contains(string(pinned), quote) {
			t.Fatalf("pinned binding rules no longer say %q", quote)
		}
	}
}

type reviewIsRedeclarationRule struct {
	key, body string
	reject    bool
}

func reviewIsRedeclarationRules() []reviewIsRedeclarationRule {
	return []reviewIsRedeclarationRule{
		{"same-two-if", "if (a is let cell) { void cell; } if (b is let cell) { void cell; }", true},
		{"same-two-object-heads", "if (a is { id: let cell }) { void cell; } if (b is { id: let cell }) { void cell; }", true},
		{"same-expression-and-if", "a is let cell; if (b is let cell) { void cell; }", true},
		{"same-two-expressions", "a is let cell; b is let cell;", true},
		{"same-lexical-and-if", "let cell: unknown; if (a is let cell) { void cell; }", true},
		{"separate-blocks", "{ if (a is let cell) { void cell; } } { if (b is let cell) { void cell; } }", false},
		{"inner-shadow", "if (a is let cell) { if (b is let cell) { void cell; } }", false},
		{"loop-head-shadow", "if (a is let cell) { void cell; } while (b is let cell) { void cell; break; }", false},
		{"within-one-pattern", "if (a is { first: let cell, second: let cell }) { void cell; }", false},
		{"within-array-pattern", "if (a is [let cell, let cell]) { void cell; }", false},
		{"within-nested-pattern", "if (a is { first: { value: let cell }, second: let cell }) { void cell; }", false},
		{"within-const-pattern", "if (a is { first: const cell, second: const cell }) { void cell; }", false},
		{"within-or-pattern", "if (a is ({ first: let cell } or { second: let cell })) { void cell; }", false},
	}
}

func reviewIsRedeclarationHome(body string, home uint8) string {
	switch home % 5 {
	case 0:
		return "export function probe(a: unknown, b: unknown): void { " + body + " }\n"
	case 1:
		return "export const probe = (a: unknown, b: unknown): void => { " + body + " };\n"
	case 2:
		return "export class Holder { probe(a: unknown, b: unknown): void { " + body + " } }\n"
	case 3:
		return "export function probe(a: unknown, b: unknown): void { { " + body + " } }\n"
	default:
		return "export {}; declare const a: unknown, b: unknown;\n" + body + "\n"
	}
}

// R3 OPUS-1, interpreted by accepted detail245: distinct top-level patterns
// share their lexical home's ordinary let redeclaration rule. Repeated names
// inside ONE top-level pattern retain the pinned runtime rule, not TS2451.
// Parameter collisions are absent: their native diagnostic identity differs.
func FuzzReviewIsRedeclarations(f *testing.F) {
	startShortBudget(f)
	rules := reviewIsRedeclarationRules()
	for _, rule := range rules {
		for home := range uint8(5) {
			f.Add(rule.key, home)
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, home uint8) {
		TestReviewIsRedeclarationsQuoted(t)
		index := slices.IndexFunc(rules, func(rule reviewIsRedeclarationRule) bool { return rule.key == key })
		if index < 0 {
			if key == "" {
				return
			}
			index = int(key[0]) % len(rules)
		}
		home %= 5
		rule := rules[index]
		source := reviewIsRedeclarationHome(rule.body, home)
		referenceBody := "{ let cell = 0; void cell; } { let cell = 1; void cell; }"
		if rule.reject {
			referenceBody = "let cell = 0; let cell = 1; void cell;"
		}
		var reference *Result
		var referenceErr error
		within(t, "check ordinary TypeScript lexical-home control", func() {
			reference, referenceErr = w.Compile(t.Context(), Project{Files: map[string]string{"main.ts": reviewIsRedeclarationHome(referenceBody, home)}})
		})
		if referenceErr != nil {
			t.Fatal(referenceErr)
		}
		defer reference.Remove()
		nativeRedeclaration := false
		for _, diagnostic := range reference.Diagnostics {
			if !IsEK(diagnostic) && diagnostic.Code() == 2451 {
				nativeRedeclaration = true
			}
		}
		if nativeRedeclaration != rule.reject || !rule.reject && HasError(reference.Diagnostics) {
			t.Fatalf("invalid native lexical-home control: %v", SortedKeys(Keys(reference.Dir, reference.Diagnostics)))
		}
		var result *Result
		var err error
		within(t, "check is redeclaration home", func() { result, err = w.Compile(t.Context(), Single(source)) })
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		redeclared := false
		for _, diagnostic := range result.Diagnostics {
			if !IsEK(diagnostic) && diagnostic.Code() == 2451 && diagnostic.Category().Name() == "error" {
				redeclared = true
			}
		}
		gapKey := fmt.Sprintf("%s:%d", rule.key, home)
		if rule.reject && !redeclared || !rule.reject && HasError(result.Diagnostics) {
			Gap(t, reviewIsRedeclarationsTarget, gapKey,
				"Chapter4/pinned ordinary-binding rule (detail245): reject TS2451=%t, got %v\n%s",
				rule.reject, SortedKeys(Keys(result.Dir, result.Diagnostics)), source)
		}
		ExpectPending(t, reviewIsRedeclarationsTarget, gapKey)
		ExpectPending(t, reviewIsRedeclarationsTarget, specCorpusKey(t))
	})
}
