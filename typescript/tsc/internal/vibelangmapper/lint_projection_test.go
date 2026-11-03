package vibelangmapper

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/locale"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

func lintContext(name string) FileContext {
	return FileContext{FileName: name, ModuleKey: "p/src/a", Lint: true}
}

func TestLintProjectionKeepsSourceLines(t *testing.T) {
	source := "// first\nexport function f() {\n  return 1\n}\n"
	lines := strings.Split(Project(source, lintContext("/src/a.vibe")).Text, "\n")
	if lines[0] != "// first" || !strings.HasPrefix(lines[1], "export function f()") {
		t.Fatalf("source lines moved: %q", lines)
	}
	if !strings.Contains(lines[len(lines)-2], PreludeModule) {
		t.Fatalf("the prelude line is not last: %q", lines)
	}
}

func TestLintProjectionOfNoStatementsIsTheSource(t *testing.T) {
	for _, source := range []string{"", "\n", "// nothing\n"} {
		if got := Project(source, lintContext("/src/a.vibe")).Text; got != source {
			t.Fatalf("%q projected to %q", source, got)
		}
	}
}

func TestLintProjectionLowersUndecidablePipeTopics(t *testing.T) {
	for _, source := range []string{
		"export const a = (s: S) => f(s) |> g(%)",
		"export function m() { return try (f(1) |> g(%)) }",
		"export const a = (s: S): infer _ => f(s) |> g<T>({ a: 1 })(%)",
		"const a = (effect { return 1 } |> f(%))",
		"function g() { return try (effect { const f = try u.get(\"h\"); return f } |> Effect.orDie(%)) }",
	} {
		lint := Project(source, lintContext("/src/a.vibe"))
		if strings.Contains(lint.Text, "|>") {
			t.Fatalf("%s kept its pipe: %s", source, lint.Text)
		}
		assertValidMap(t, lint, source)
	}
}

func TestLintProjectionParsesVibexAsTSX(t *testing.T) {
	source := "export const a = <div key=\"a\" />\n"
	lint := Project(source, lintContext("/src/a.vibex"))
	if !strings.Contains(lint.Text, source) {
		t.Fatalf("JSX did not pass through: %s", lint.Text)
	}
}

// The checking projection is what stock TypeScript reads: Lint must not change it.
func TestCheckingProjectionIgnoresLintForms(t *testing.T) {
	source := "export const a = (s: S) => f(s) |> g(%)"
	checking := Project(source, testContext)
	if !strings.Contains(checking.Text, "|>") || !strings.HasPrefix(checking.Text, "import {") {
		t.Fatalf("checking projection changed: %s", checking.Text)
	}
	found := false
	for _, d := range checking.Diagnostics {
		found = found || d.Code == CodeFormChoice
	}
	if !found {
		t.Fatalf("checking projection lost its form choice: %+v", checking.Diagnostics)
	}
}

// alchemy demos/effect-prezzy: a pipe's invoked block walked itself forever.
func TestProjectionOfAnInvokedBlockInAPipeTerminates(t *testing.T) {
	for _, source := range []string{
		"const a = (effect { return 1 } |> f(%))",
		"function g() { return (effect { return 1 } |> f(%)) }",
	} {
		assertValidMap(t, Project(source, testContext), source)
		assertValidMap(t, Project(source, lintContext("/src/a.vibe")), source)
	}
}

// smithers apps/tui/src/session.vibe: a catch's if without a block panicked.
func TestProjectionOfAnUnbracedIfInACatch(t *testing.T) {
	source := "function h(x: string) { for (const y of z) { try { a() } catch (e) { if (x) throw e } } }"
	assertValidMap(t, Project(source, testContext), source)
}

// Forms the checking projection leaves as text a TypeScript parser rejects, from
// alchemy's and Smithers' trees. Parsing is the contract: the host is a parser.
func TestLintProjectionParses(t *testing.T) {
	for _, source := range []string{
		"function m() { return try effect { return 1 } }",
		"const a = effect { return try effect { return 1 } }",
		"const c = g(x, (try effect { return 1 }))",
		"const a = effect { const c = try Database; return c }",
		"function f() { expect(error is Bad).toBe(true) }",
		"function f() { return a.b is C.D }",
		"const p = effect (s: string): Effect<P, F, infer R> => { return 1 }",
		"const held = Effect.gen(function*() { const h = yield* (yield* S).get(v)\n  |> Effect.as(%, 1); return h })",
		"async function f(): Promise<number> { return await g() |> h(%) }",
		"module text { export function clean(s: string): string { return s } }\nimport { clean } from text\nimport text\nexport const a = clean(\"a\")",
		"const a = effect { return 1 }\n  |> f(%)",
		"const a = effect { provide L { return try g() } }",
		"export const a = effect { return 1 }\n  .pipe(f)",
		"export const a = { b: effect { return 1 } as any!! }",
		"const x = g()\n    effect {\n      try h()\n      return 1\n    }",
		"function f() { return try effect { provide L { return 1 } } }",
		"const c = new W<A, M<symbol, any!any!any>>()",
		"const o = { a: g() as any!! }",
		"export type T = \"a\" | { mutable b: string }",
		"export const r = effect (o: O): B | undefined!E => { return 1 }",
	} {
		lint := Project(source, lintContext("/src/a.vibe"))
		assertValidMap(t, lint, source)
		file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: tspath.RootedFilePathFromAbsolute("/a.ts")}, lint.Text, core.ScriptKindTS)
		if diagnostics := file.Diagnostics(); len(diagnostics) > 0 {
			t.Errorf("%s\nprojected to\n%s\nwhich does not parse: %s", source, lint.Text, diagnostics[0].Localize(locale.Default))
		}
	}
}
