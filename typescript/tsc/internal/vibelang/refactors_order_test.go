package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
)

const refactorOrderHelpers = "function f(n: number): number { return n }\n" +
	"function g(n: number): number { return n }\n" +
	"function expensive(n: number): number { return n }\n" +
	"function make(): (n: number) => number { return f }\n" +
	"function next(): number { return 1 }\n" +
	"function other(): number { return 2 }\n" +
	"function pair(a: number, b: number): number { return a + b }\n"

// refactorAt returns the refactor named action offered at /*cursor*/ in
// source, or nil.
func refactorAt(t *testing.T, source, action string) (*ls.CodeAction, string, func(*ls.CodeAction) string) {
	t.Helper()
	pos := strings.Index(source, "/*cursor*/")
	source = strings.ReplaceAll(source, "/*cursor*/", "")
	program, file, service, converters := editorProgram(t, source)
	apply := func(chosen *ls.CodeAction) string { return applyEditorEdits(t, file, converters, chosen.Changes) }
	for _, offered := range vibelangRefactors(t.Context(), &ls.RefactorContext{SourceFile: file, Span: core.NewTextRange(pos, pos), Program: program, LS: service}) {
		if offered.Description == action {
			return offered, source, apply
		}
	}
	return nil, source, apply
}

// #454: a pipe evaluates its left side first, and always. The refactors
// between pipes and calls are offered only where that order holds.
func TestPipeRefactorsKeepEvaluationOrder(t *testing.T) {
	for _, test := range []struct{ name, source, action string }{
		{"optional call", "export function use(logger: { log(n: number): number } | undefined, x: number) { return /*cursor*/logger?.log(expensive(x)) }", "Convert to a pipe"},
		{"computed callee", "export function use(x: number) { return /*cursor*/make()(g(x)) }", "Convert to a pipe"},
		{"property callee", "export function use(o: { m(n: number): number }, x: number) { return /*cursor*/o.m(g(x)) }", "Convert to a pipe"},
		{"topic after a call", "export const value = next() /*cursor*/|> pair(other(), %)", "Convert the pipe to calls"},
		{"topic in a branch", "export function use(cond: boolean) { return next() /*cursor*/|> (cond ? f(%) : 0) }", "Convert the pipe to calls"},
		{"topic in a function", "export const value = next() /*cursor*/|> (() => g(%))", "Convert the pipe to calls"},
	} {
		t.Run(test.name, func(t *testing.T) {
			if chosen, source, apply := refactorAt(t, refactorOrderHelpers+test.source, test.action); chosen != nil {
				t.Fatalf("%q offered; it would change evaluation order:\n%s\nbecomes\n%s", test.action, source, apply(chosen))
			}
		})
	}
	for _, test := range []struct{ name, source, action, want string }{
		{"named calls", "export function use(x: number) { return /*cursor*/f(g(x)) }", "Convert to a pipe", "export function use(x: number) { return x |> g(%) |> f(%) }"},
		{"topic first", "export const value = next() /*cursor*/|> pair(%, other())", "Convert the pipe to calls", "export const value = pair(next(), other())"},
	} {
		t.Run(test.name, func(t *testing.T) {
			chosen, _, apply := refactorAt(t, refactorOrderHelpers+test.source, test.action)
			if chosen == nil {
				t.Fatalf("missing refactor %q", test.action)
			}
			if got := apply(chosen); got != refactorOrderHelpers+test.want {
				t.Fatalf("edited source:\n%s\nwant:\n%s", got, refactorOrderHelpers+test.want)
			}
		})
	}
}

// #454: the inferred contract goes after the ) that closes the parameter
// list, not a ) in a type parameter or a comment.
func TestInferredContractAfterParameterList(t *testing.T) {
	for _, test := range []struct{ name, source, want string }{
		{"function type parameter", "export effect function /*cursor*/make<T extends () => void>() { return 1 }", "export effect function make<T extends () => void>(): number!! { return 1 }"},
		{"arrow type parameter", "export const make = /*cursor*/effect <T extends (a: number) => void>() => 1", "export const make = effect <T extends (a: number) => void>(): number!! => 1"},
		{"comment", "export effect function /*cursor*/f(a: number /* :) */) { return a }", "export effect function f(a: number /* :) */): number!! { return a }"},
	} {
		t.Run(test.name, func(t *testing.T) {
			chosen, _, apply := refactorAt(t, test.source, "Write the inferred contract")
			if chosen == nil {
				t.Fatal("missing refactor")
			}
			if got := apply(chosen); got != test.want {
				t.Fatalf("edited source:\n%s\nwant:\n%s", got, test.want)
			}
		})
	}
}
