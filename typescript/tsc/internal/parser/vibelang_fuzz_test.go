package parser

import (
	"testing"
	"unicode/utf8"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

// FuzzVibeLangParser fuzzes the VibeLang/Vibex parser directly (unlike upstream
// FuzzParser, which only seeds .ts/.js fixtures). It enforces universal parser
// invariants across valid, adversarial, and arbitrary mutated UTF-8 inputs:
//
//   - ParseSourceFile never panics on any UTF-8 input.
//   - Every AST node satisfies 0 <= Pos <= End <= len(text).
//   - Parsing the same input twice is strictly deterministic in AST node count
//     and diagnostic codes/positions.
func FuzzVibeLangParser(f *testing.F) {
	seeds := []string{
		"export effect function load(id: string): string!Boom { return try fetch(id) }\n",
		"export effect function* ticks() { yield 1; try sleep(\"1 second\"); yield 2 }\n",
		"export error NotFound { id: string }\nexport error Timeout\n",
		"export schema User { id: string; nick?: string; readonly role: \"a\" | \"b\"; items: Held[] }\n",
		"export schema Code = \"a\" | \"b\"\nexport schema error FsErr { path: string }\n",
		"export service Users { static readonly key = \"app/Users\"; find(id: string): User!NotFound }\n",
		"export data Delivery { Waiting; Sent { tracking: string } }\n",
		"export data Outcome<A, E> { Ok { value: A }; Err { error: E } }\n",
		"export function m(x: unknown) { return match (x) { when 1: \"a\"; when { _tag: \"Sent\", let tracking }: tracking; when 0 or 1: \"b\"; default: \"c\"; } }\n",
		"export function isCheck(x: unknown) { const a = x is 1; const b = x is 0 or 1; if (x is NotFound(let e)) return e.id; return a || b }\n",
		"export effect function conc(xs: string[]) { for concurrent(4) (const x of xs) { try work(x) } }\n",
		"export effect function concOneLine(xs: string[]) { for concurrent (const x of xs) { try work(x) } }\n",
		"export effect function stream(s: any) { for try (const x of s) { if (x) continue; break } }\n",
		"export effect function forks() { const a = fork work(); const b = fork.scoped work(); const c = fork.detached work(); return try.all [join a, join b, join c] }\n",
		"export effect function prov(impl: any) { provide Users = impl { uninterruptible { restore { return try work() } } } }\n",
		"export effect function catches() { return work() catch (e) => e; }\n",
		"export effect function catchEff() { return work() catch effect (e) => { throw e } }\n",
		"export function piped(n: number) { return n |> % + 1 |> String(%) }\n",
		"export function doExpr() { return do { const x = 1; x + 2 } }\n",
		// Missed real bug classes: #500 bigint object-pattern key, #414 computed key, #458 type Effect shadow, #429 wrapped super, #428 try in sync
		"export function bigintPat(o: any) { const { 1n: x } = o; return match (o) { when { 1n: let v }: v; default: x; } }\n",
		"export const policy = { [k]: 1 }\n",
		"export type Effect = { x: number }\nexport const v: Effect = { x: 1 }\n",
		"class Sub extends Base { effect m() { return try (super.m)() + try super.m!() } }\n",
		"export effect function nestedTry() { return try sync(() => try work()) }\n",
		"export module text { export const a = 1 }\nimport { a } from text\n",
		"export const el = <Box value={1} />;\n",
		"export task step(x: number) { return x }\nexport workflow flow() { return try step(1) }\n",
		// Malformed / recovery seeds
		"match (x) { when { 1n: ",
		"for concurrent( (",
		"schema S { [1n]: ",
		"provide = { uninterruptible { restore ",
		"effect function f(: string!E!R",
	}
	for _, s := range seeds {
		f.Add(uint8(0), s)
		f.Add(uint8(1), s)
	}

	f.Fuzz(func(t *testing.T, ext uint8, text string) {
		if !utf8.ValidString(text) || len(text) > 16<<10 {
			return
		}
		fileName := "/fuzz.vibe"
		kind := core.ScriptKindTS
		if ext%2 == 1 {
			fileName = "/fuzz.vibex"
			kind = core.ScriptKindTSX
		}
		opts := ast.SourceFileParseOptions{
			FileName: tspath.RootedFilePath(fileName),
			PathKey:  tspath.PathKey(fileName),
		}
		sf1 := ParseSourceFile(opts, text, kind)
		sf2 := ParseSourceFile(opts, text, kind)

		count1 := checkParserBounds(t, fileName, text, sf1)
		count2 := checkParserBounds(t, fileName, text, sf2)
		if count1 != count2 {
			t.Fatalf("%s: non-deterministic AST node count: %d vs %d", fileName, count1, count2)
		}
		d1, d2 := sf1.Diagnostics(), sf2.Diagnostics()
		if len(d1) != len(d2) {
			t.Fatalf("%s: non-deterministic diagnostic count: %d vs %d", fileName, len(d1), len(d2))
		}
		for i := range d1 {
			if d1[i].Code() != d2[i].Code() || d1[i].Pos() != d2[i].Pos() || d1[i].Len() != d2[i].Len() {
				t.Fatalf("%s: non-deterministic diagnostic[%d]: (%d,%d,%d) vs (%d,%d,%d)",
					fileName, i, d1[i].Code(), d1[i].Pos(), d1[i].Len(), d2[i].Code(), d2[i].Pos(), d2[i].Len())
			}
		}
	})
}

func checkParserBounds(t *testing.T, fileName, text string, sf *ast.SourceFile) int {
	t.Helper()
	n := len(text)
	count := 0
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		if node == nil {
			return false
		}
		count++
		pos, end := node.Pos(), node.End()
		if pos < 0 || end < 0 || pos > end || end > n {
			t.Fatalf("%s: node %v has invalid range [%d, %d] (len=%d)\nsource:\n%s",
				fileName, node.Kind, pos, end, n, text)
		}
		node.ForEachChild(visit)
		return false
	}
	sf.AsNode().ForEachChild(visit)
	return count
}
