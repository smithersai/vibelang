package vibelangfuzz

import (
	"context"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

// tryOperationElementsQuote is chapter 2's try operation operand rule (Running Effects concurrently, Syntax; VIP-18).
const tryOperationElementsQuote = "The operand is any expression whose type is an array, readonly array or tuple of Effects, not only an array literal (VIP-18, amended)"

const tryOperationElementsTarget = "FuzzTryOperationElements"

func requireTryOperationElementsQuote(t testing.TB) {
	t.Helper()
	chapter, err := os.ReadFile(filepath.Join(Root(), "docs/design/src/002-running.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(chapter), tryOperationElementsQuote) {
		t.Fatal("stale try operation elements citation")
	}
}

func TestTryOperationElementsQuoted(t *testing.T) { requireTryOperationElementsQuote(t) }

// An element call of a try operation's array literal gives its Effect while
// the literal is built, as Effect.all([a(), b()]) builds it (decided detail
// 252): the emitted JavaScript passes the calls in the array as written,
// with no Effect.suspend around them, for all four operations, with or
// without a spread, parenthesized or not; a nested running call still runs
// during construction.
func FuzzTryOperationElements(f *testing.F) {
	startShortBudget(f)
	requireTryOperationElementsQuote(f)
	w := NewWorkspace(f)
	const prelude = "import { Effect } from \"effect\"\nconst a = (n: number) => Effect.succeed(n)\neffect function b() { return 2 }\n"
	sites := []struct{ key, source string }{
		{"all-calls", "export effect function f() { return try.all [a(1), a(2)] }"},
		{"race-calls", "export effect function f() { return try.race [a(1), a(2)] }"},
		{"any-calls", "export effect function f() { return try.any [a(1), a(2)] }"},
		{"allSettled-calls", "export effect function f() { return try.allSettled [a(1), a(2)] }"},
		{"allSettled-spread-between", "export effect function f(xs: Set<Effect.Effect<number>>) { return try.allSettled [a(1), ...xs, a(2)] }"},
		{"all-parenthesized", "export effect function f() { return try.all [(a(1)), a(2)] }"},
		{"all-effect-function", "export effect function f() { return try.all [b(), a(1)] }"},
		{"all-nested-running-call", "export effect function f() { return try.all [a(try b()), a(1)] }"},
		{"allSettled-parenthesized", "export effect function f() { return try.allSettled [(a(1)), a(2)] }"},
		{"allSettled-effect-function", "export effect function f() { return try.allSettled [b(), a(1)] }"},
		{"allSettled-nested-running-call", "export effect function f() { return try.allSettled [a(try b()), a(1)] }"},
		{"allSettled-shadow", "export effect function f() { const Effect = { all: 0, exit: 0 }; return try.allSettled [a(1), a(2)] }"},
	}
	for _, site := range sites {
		f.Add(site.key)
	}
	f.Fuzz(func(t *testing.T, key string) {
		i := slices.IndexFunc(sites, func(site struct{ key, source string }) bool { return site.key == key })
		if i < 0 {
			if key == "" {
				return
			}
			i = int(key[0]) % len(sites)
		}
		site := sites[i]
		gapKey := "rule:" + site.key
		source := prelude + site.source + "\n"
		r, err := w.Compile(context.Background(), Single(source))
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		js := ""
		for name, text := range r.Outputs {
			if strings.HasSuffix(name, "main.js") {
				js = text
			}
		}
		errored := slices.ContainsFunc(r.Diagnostics, func(d *ast.Diagnostic) bool { return d.Category() == diagnostics.CategoryError })
		if errored || js == "" {
			Gap(t, tryOperationElementsTarget, gapKey, "%s; expected no error and an emitted main.js\n%s\n%v", tryOperationElementsQuote, source, Keys(r.Dir, r.Diagnostics))
		} else if call := tryOperationCall(js); call == "" || strings.Contains(call, "suspend(") {
			Gap(t, tryOperationElementsTarget, gapKey, "%s; expected the element calls in the array with no Effect.suspend\n%s\n%s", tryOperationElementsQuote, source, js)
		}
		ExpectPending(t, tryOperationElementsTarget, gapKey)
		ExpectPending(t, tryOperationElementsTarget, specCorpusKey(t))
	})
}

// tryOperationCall reads the operation call, never its helper import or the
// enclosing function's Effect.suspend. A tail operation may be carried in a
// completion record before a separate yield delegates it. This oracle checks
// element construction; FuzzVIPDifferential checks execution.
// Direct VIP-18 output uses the namespace imported from effect/Effect.
func tryOperationCall(js string) string {
	file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/main.js", PathKey: "/main.js"}, js, core.ScriptKindJS)
	if len(file.Diagnostics()) != 0 {
		return ""
	}
	modules := map[string]bool{}
	for _, statement := range file.Statements.Nodes {
		if !ast.IsImportDeclaration(statement) {
			continue
		}
		declaration := statement.AsImportDeclaration()
		if declaration.ImportClause == nil || declaration.ModuleSpecifier.Text() != "effect/Effect" {
			continue
		}
		bindings := declaration.ImportClause.AsImportClause().NamedBindings
		if bindings != nil && ast.IsNamespaceImport(bindings) {
			modules[bindings.Name().Text()] = true
		}
	}
	var call *ast.Node
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if ast.IsCallExpression(node) {
			callee := node.Expression()
			helper := ast.IsIdentifier(callee) && (strings.HasPrefix(callee.Text(), "$tryAll") || strings.HasPrefix(callee.Text(), "$tryRace") || strings.HasPrefix(callee.Text(), "$tryAny"))
			direct := ast.IsPropertyAccessExpression(callee) && callee.Name().Text() == "all" && ast.IsIdentifier(callee.Expression()) && modules[callee.Expression().Text()]
			if helper || direct {
				call = node
				return true
			}
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
	if call == nil {
		return ""
	}
	return strings.TrimSpace(js[call.Pos():call.End()])
}
