package vibelangfuzz

import (
	"os"
	"strings"
	"testing"
)

const (
	legacyVarFixQuote      = "`let`, or `const` when the binding is never assigned"
	legacyVarPreserveQuote = "Diagnostics retain their existing codes, categories and eligibility; compiling a file does not apply a source rewrite."
)

func requireLegacyVarRewriteQuotes(t testing.TB) {
	t.Helper()
	for chapter, quote := range map[string]string{"001-functions.md": legacyVarFixQuote, "007-tooling.md": legacyVarPreserveQuote} {
		data, err := os.ReadFile(SpecPath(chapter))
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(string(data), quote) {
			t.Fatalf("%s no longer says %q", chapter, quote)
		}
	}
}

func TestLegacyVarRewriteQuoted(t *testing.T) { requireLegacyVarRewriteQuotes(t) }

// legacyVarShapes are var programs keyed by shape. offered marks the shapes
// whose block scoping cannot change what runs, which must get the rewrite.
var legacyVarShapes = []struct {
	key, source string
	offered     bool
}{
	{"top-const", "export function run(c: boolean) { var x = 1; return [c, x] }", true},
	{"top-let", "export function run(c: boolean) { var x = 1; if (c) x += 2; return x }", true},
	{"block", "export function run(c: boolean) { if (c) { var x = 2; return x } return 0 }", true},
	{"closure-after", "export function run(c: boolean) { var x = 3; const f = () => c ? x : -x; return f() }", false},
	{"module", "var x = 4\nexport const run = (c: boolean) => c ? x : 0", false},
	{"module-function", "var x = 4\nexport function run(c: boolean) { return c ? x : 0 }", false},
	{"destructuring", "export function run(c: boolean) { var { a, b = a } = { a: c ? 5 : 6 }; return [a, b] }", false},
	{"type-number", "export function run(c: boolean) { var x = 1; return [c, x] as const }", true},
	{"type-string", "export function run(c: boolean) { var x = \"hello\"; return [c, x] as const }", true},
	{"type-negative", "export function run(c: boolean) { var x = -2; return [c, x] as const }", true},
	{"type-conditional", "export function run(c: boolean) { var x = c ? 1 : 2; return [x] as const }", true},
	{"type-query", "export function run(c: boolean) { var x = 1; const y: typeof x = 2; return [c, y] }", true},
	{"type-generic", "function keep<const T>(x: T): T { return x }; export function run(c: boolean) { var x = 1; return keep([c, x] as const) }", true},
	{"type-written", "export function run(c: boolean) { var x: number = 1; return [c, x] as const }", true},

	{"capture-boolean", "export function run(c: boolean) { var x = true; return () => [c, x] as const }", false},
	{"capture-written-union", "export function run(c: boolean) { var x: string | undefined = c ? \"yes\" : undefined; if (x) return () => [x] as const; return () => [x] as const }", false},
	{"capture-method", "export function run(c: boolean) { var x = true; return { read() { return [c, x] as const } }.read }", false},

	{"hoisted-read", "export function run(c: boolean) { const early = h(); var x = 5; function h() { return typeof x } return [early, x, c] }", false},
	{"before-read", "export function run(c: boolean) { const y = typeof x; var x = 6; return [y, x, c] }", false},
	{"loop-closure", "export function run(c: boolean) { const fs: (() => number)[] = []; for (const i of [1, 2]) { var x = c ? i : -i; fs.push(() => x) } return fs.map(f => f()) }", false},
	{"outside-block", "export function run(c: boolean) { if (c) { var x = 7 } return x }", false},
	{"redeclare", "export function run(c: boolean) { var x = 1; if (c) { var x = 2 } return x }", false},
	{"self-init", "export function run(c: boolean) { var x: any = c ? typeof x : 0; return x }", false},
	{"case", "export function run(c: boolean) { switch (c ? 1 : 2) { case 1: var x = 8; return x; default: return typeof x } }", false},
}
