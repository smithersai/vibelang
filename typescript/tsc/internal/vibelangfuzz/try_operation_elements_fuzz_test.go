package vibelangfuzz

import (
	"context"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
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
	}
	for i := range sites {
		f.Add(uint8(i))
	}
	f.Fuzz(func(t *testing.T, n uint8) {
		site := sites[int(n)%len(sites)]
		key := "rule:" + site.key
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
			Gap(t, tryOperationElementsTarget, key, "%s; expected no error and an emitted main.js\n%s\n%v", tryOperationElementsQuote, source, Keys(r.Dir, r.Diagnostics))
		} else if call := tryOperationCall(js); call == "" || strings.Contains(call, "suspend(") {
			Gap(t, tryOperationElementsTarget, key, "%s; expected the element calls in the array with no Effect.suspend\n%s\n%s", tryOperationElementsQuote, source, js)
		}
		ExpectPending(t, tryOperationElementsTarget, key)
		ExpectPending(t, tryOperationElementsTarget, specCorpusKey(t))
	})
}

// tryOperationCall returns the emitted try operation call through the end of
// its line, $tryAll([a(1), a(2)]) ...: the enclosing function's own
// Effect.suspend (D500 lowering) is outside it and not an element's.
func tryOperationCall(js string) string {
	i := strings.Index(js, "$try")
	if i < 0 {
		return ""
	}
	line, _, _ := strings.Cut(js[i:], "\n")
	return line
}
