package parser_test

import (
	"slices"
	"strconv"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/binder"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

// matchGrammarCodes parses source as a .vibe file and returns the code of
// each $patternError call the parser wrote, in source order of the calls,
// and the code of each syntax diagnostic.
func matchGrammarCodes(t *testing.T, source string) (patternErrors, syntax []int) {
	t.Helper()
	file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/test.vibe", PathKey: "/test.vibe"}, source, core.ScriptKindTS)
	binder.BindSourceFile(file)
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if ast.IsCallExpression(node) && ast.IsIdentifier(node.Expression()) && node.Expression().Text() == "$patternError" {
			if args := node.Arguments(); len(args) > 0 && args[0].Kind == ast.KindNumericLiteral {
				code, err := strconv.Atoi(args[0].Text())
				if err != nil {
					t.Fatal(err)
				}
				patternErrors = append(patternErrors, code)
			}
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
	for _, d := range file.Diagnostics() {
		syntax = append(syntax, int(d.Code()))
	}
	return patternErrors, syntax
}

// Appendix A: ArmBody is Expression[+In], the comma operator included. A
// comma before the next arm is still the mistaken separator of EK0701.
func TestVibeLangMatchArmBodyIsExpression(t *testing.T) {
	for _, row := range []struct {
		name, source string
		want         []int
	}{
		{"comma", `const r = match (x) { when 1: n++, "one"; default: "other"; }`, nil},
		{"comma-default", `const r = match (x) { when 1: n; default: n++, "other"; }`, nil},
		{"comma-then-when-call", `const r = match (x) { when 1: n, when(x); default: 0; }`, nil},
		{"comma-then-when-name", `const r = match (x) { when 1: n, when; default: 0; }`, nil},
		{"in-for-initializer", `for (let i = match (1) { when 1: "x" in o ? 5 : 0; default: 0; }; i < 6; i++) out++`, nil},
		{"throw-in-for-initializer", `for (let i = match (1) { when 1: 1; default: throw "x" in o; }; i < 6; i++) out++`, nil},
		{"separator-when", `const r = match (x) { when 1: 1, when 2: 2; default: 0; }`, []int{701}},
		{"separator-default", `const r = match (x) { when 1: 1, default: 0; }`, []int{701}},
		{"separator-close", `const r = match (x) { when 1: 1; default: 0, }`, []int{701}},
		{"separator-after-comma", `const r = match (x) { when 1: n++, 1, default: 0; }`, []int{701}},
	} {
		t.Run(row.name, func(t *testing.T) {
			patternErrors, syntax := matchGrammarCodes(t, row.source)
			if !slices.Equal(patternErrors, row.want) || len(syntax) != 0 {
				t.Fatalf("pattern errors %v, syntax %v; want %v and no syntax error: %s", patternErrors, syntax, row.want, row.source)
			}
		})
	}
}

// The early errors of the pinned draft (spec.emu, Static Semantics: Early
// Errors of patterns) are EK0707, which the parser writes as code 707, or
// 4705 for combinators that need parentheses.
func TestVibeLangMatchPatternEarlyErrors(t *testing.T) {
	for _, row := range []struct {
		name, pattern string
		want          []int
	}{
		{"required-after-optional", "[1, 2?, 3]", []int{707}},
		{"required-after-optional-extractor", "Some(1?, 2)", []int{707}},
		{"elision-after-optional", "[1, 2?, , ]", []int{707}},
		{"both-report-once", "[1?, 2, , 3]", []int{707}},
		{"optional-run", "[1, 2?, 3?]", nil},
		{"optional-then-rest", "[1, 2?, ...]", nil},
		{"optional-then-bound-rest", "[1, 2?, ...let rest]", nil},
		{"elision-before-optional", "[, 1, 2?]", nil},
		{"nested-lists-are-separate", "[[1?], 2]", nil},
		{"not-not", "not not 1", []int{4705}},
		{"not-not-not", "not not not 1", []int{4705}},
		{"not-parenthesized-not", "not (not 1)", nil},
		{"object-rest-name", "{ a: 1, ...rest }", []int{707}},
		{"object-rest-member", "{ a: 1, ...ns.rest }", []int{707}},
		{"list-rest-name", "[1, ...rest]", []int{707}},
		{"extractor-rest-name", "Some(1, ...rest)", []int{707}},
		{"object-rest-binding", "{ a: 1, ...let rest }", nil},
		{"object-rest-parenthesized", "{ a: 1, ...(isEmpty) }", nil},
		{"list-rest-binding", "[1, ...let rest]", nil},
		{"list-rest-pattern", "[1, ...[2]]", nil},
		{"shift", ">> 1", []int{707}},
		{"unsigned-shift", ">>> 1", []int{707}},
		{"shift-assign", ">>= 1", []int{707}},
		{"greater", "> 1", nil},
		{"greater-equal", ">= 1", nil},
	} {
		t.Run(row.name, func(t *testing.T) {
			for _, source := range []string{
				"const r = match (x) { when " + row.pattern + ": 1; default: 0; }",
				"const r = x is " + row.pattern,
			} {
				patternErrors, syntax := matchGrammarCodes(t, source)
				// A binding in an is that no statement claimed is 4703, which
				// is not the pattern's grammar.
				patternErrors = slices.DeleteFunc(patternErrors, func(code int) bool { return code == 4703 })
				if !slices.Equal(patternErrors, row.want) || len(syntax) != 0 {
					t.Fatalf("pattern errors %v, syntax %v; want %v and no syntax error: %s", patternErrors, syntax, row.want, source)
				}
			}
		})
	}
}

// ECMA-262 5.1.5: a terminal of the grammar is not written with an escape.
// match, when, and, or and not report TS1260 as the keyword is does.
func TestVibeLangMatchWordsCannotBeEscaped(t *testing.T) {
	for _, row := range []struct {
		name, source string
		want         int
	}{
		{"match", `const a = m\u0061tch (x) { when 1: "one"; default: "other"; }`, 1},
		{"async-match", `const a = async m\u0061tch (x) { when 1: "one"; default: "other"; }`, 1},
		{"when", `const a = match (x) { wh\u0065n 1: "one"; default: "other"; }`, 1},
		{"not", `const a = match (x) { when n\u006ft 1: "one"; default: "other"; }`, 1},
		{"and", `const a = match (x) { when 1 \u0061nd 1: "one"; default: "other"; }`, 1},
		{"or", `const a = match (x) { when 1 \u006fr 2: "one"; default: "other"; }`, 1},
		{"is", `const a = x \u0069s 1`, 1},
		{"is-not", `const a = x is n\u{6f}t 1`, 1},
		{"all", "const a = m\\u0061tch (x) { wh\\u0065n n\\u006ft 1: 1; when 1 \\u0061nd 2: 2; default: 0; }\nconst b = x \\u0069s 1", 5},
		{"plain", `const a = match (x) { when not 1: "one"; when 1 and 2: "two"; when 1 or 2: "three"; default: "other"; }`, 0},
		{"escaped-name-is-a-name", `const a = wh\u0065n + n\u006ft + m\u0061tch`, 0},
	} {
		t.Run(row.name, func(t *testing.T) {
			patternErrors, syntax := matchGrammarCodes(t, row.source)
			got := 0
			for _, code := range syntax {
				if code != 1260 {
					t.Fatalf("syntax %v, want only TS1260: %s", syntax, row.source)
				}
				got++
			}
			if got != row.want || len(patternErrors) != 0 {
				t.Fatalf("%d TS1260 and pattern errors %v, want %d and none: %s", got, patternErrors, row.want, row.source)
			}
		})
	}
}

// The pinned MatchProperty reads PropertyName before the binding form, so
// let, const and var are keys when what follows ends a key.
func TestVibeLangMatchKeywordPropertyKeys(t *testing.T) {
	for _, pattern := range []string{
		"{ let: 1 }", "{ const: 2 }", "{ var: 3 }", "{ let }", "{ let, const }", "{ let?: 1 }", "{ var? }",
		"{ let: let value }", "{ let value }", "{ const value?: 1 }", "{ var value, let: 1 }",
	} {
		t.Run(pattern, func(t *testing.T) {
			patternErrors, syntax := matchGrammarCodes(t, "const r = match (x) { when "+pattern+": 1; default: 0; }")
			// var in a pattern is EK0107, which is not this grammar.
			patternErrors = slices.DeleteFunc(patternErrors, func(code int) bool { return code == 107 })
			if len(patternErrors) != 0 || len(syntax) != 0 {
				t.Fatalf("pattern errors %v, syntax %v; want none", patternErrors, syntax)
			}
		})
	}
}

// What starts no arm reports once, and the arms after it still parse. The
// first arm is valid: a brace that no when or default follows opens no match.
func TestVibeLangMatchArmRecoveryReportsOnce(t *testing.T) {
	for _, row := range []struct {
		name, source string
		want         []int
	}{
		{"words", `const r = match (x) { when 0: 0; one two three; when 1: 1; default: 0; }`, []int{707}},
		{"to-when", `const r = match (x) { when 0: 0; one two three when 1: 1; default: 0; }`, []int{707}},
		{"to-default", `const r = match (x) { when 0: 0; one two three default: 0; }`, []int{707}},
		{"to-close", `const r = match (x) { when 1: 1; one two three }`, []int{707}},
		{"brackets", `const r = match (x) { when 0: 0; f(a; b) [c; d] { e; f }; when 1: 1; default: 0; }`, []int{707}},
		{"two-mistakes", `const r = match (x) { when 0: 0; one two; three four; default: 0; }`, []int{707, 707}},
	} {
		t.Run(row.name, func(t *testing.T) {
			patternErrors, _ := matchGrammarCodes(t, row.source)
			if !slices.Equal(patternErrors, row.want) {
				t.Fatalf("pattern errors %v, want %v: %s", patternErrors, row.want, row.source)
			}
		})
	}
}
