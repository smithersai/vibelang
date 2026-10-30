package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
)

func TestVIP18LegacyRewriteDraft(t *testing.T) {
	for _, test := range []struct{ name, source, want string }{
		{"array", "export function main() { return await.all [Effect.succeed(1)] }", "return (try.all [effect { return try Effect.succeed(1) }])"},
		{"race iterable", "function f(xs: Iterable<number!!>) { return await.race xs }", "return (try.race $tryGlobals.Array.from(xs))"},
		{"held iterable", "function f(xs: Iterable<number!!>) { const p: number[]!! = await.all xs; return 0 }", "const p: number[]!! = effect { return try $tryAllEffects($tryGlobals.Array.from(xs), { concurrency: \"unbounded\" }) }"},
		{"settled representation", "function f() { return await.allSettled [Effect.fail(\"bad\")] }", "mode: \"result\""},
		{"record shorthand", "function f() { const n = 1; return await.all { n } }", "{ n: effect { return n } }"},

		{"record snapshot", "function f(xs: Record<string, number!!>) { return await.all xs }", "$tryGlobals.Object.entries($trySource)"},
		{"array snapshot", "function f(xs: ReadonlyArray<number!!>) { return await.all xs }", "$tryGlobals.Array.from($tryOperands) as unknown as typeof $tryOperands"},

		{"callable Effect array", "function f(xs: ReadonlyArray<Effect.Effect<number> & (() => Effect.Effect<number>)>) { return await.all xs }", "$trySuspend($tryProgram)"},
		{"mutable join stays deferred", "effect function f() { let fiber = fork Effect.succeed(1); return await.all [join fiber] }", "effect { return join fiber }"},
		{"owned join", "effect function f() { const fiber = fork Effect.succeed(1); return await.all [join fiber] }", "$tryJoinFiber(fiber)"},
		{"owned keyed join", "effect function f() { const fiber = fork Effect.succeed(1); return await.all { a: join fiber } }", "$tryMapResults("},
		{"function array", "function f(xs: ReadonlyArray<() => Effect.Effect<number>>) { return await.all xs }", "import { suspend as $trySuspend }"},
		{"function record", "function f(xs: Record<string, () => Effect.Effect<number>>) { return await.all xs }", "$tryGlobals.Object.entries($tryFunctions).map"},
		{"record order", "function f() { return await.all { a: Effect.succeed(1) } }", "$tryMapResults("},
		{"call suffix", "function f() { return await.all([Effect.succeed(1)]).length }", "(try.all ([effect { return try Effect.succeed(1) }])).length"},
		{"shadowed all", "function all(...args: any[]) { return 0 } function f() { return await.all { a: Effect.succeed(1) } }", "import { all as $tryAllEffects } from \"effect/Effect\""},
		{"shadowed globals", "function f() { const Object = 0; const Array = 0; return await.all { a: Effect.succeed(1) } }", "$tryGlobals.Object.fromEntries("},
		{"directives", "// @ts-nocheck\n\"use client\";\nfunction f() { return await.allSettled [Effect.succeed(1)] }", "// @ts-nocheck\n\"use client\";\nimport { all as $tryAllEffects }"},
		{"catch left", "function f() { return await.all [Effect.fail(\"bad\") catch 2] }", "effect { return Effect.fail(\"bad\") catch 2 }"},
	} {
		t.Run(test.name, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, test.source)
			program.GetSemanticDiagnostics(t.Context(), file)
			c, done := program.GetTypeCheckerForFile(t.Context(), file)
			defer done()
			var call *ast.Node
			var visit func(*ast.Node) bool
			visit = func(n *ast.Node) bool {
				if awaitOperationNames[fiberHelper(n)] != "" && call == nil {
					call = n
					return false
				}
				return n.ForEachChild(visit)
			}
			file.AsNode().ForEachChild(visit)
			if call == nil {
				t.Fatal("missing old operation")
			}
			rewrite := retiredAwaitOperationRewrite(c, file, call)
			if !rewrite.fixable() {
				t.Fatalf("not fixable: %#v", rewrite)
			}
			got := applyEdits(file.Text(), rewrite.edits)
			if strings.Count(got, "import { $global as $tryGlobals }") > 1 {
				t.Fatalf("duplicate generated imports: %s", got)
			}
			if !strings.Contains(got, test.want) {
				t.Fatalf("want substring %s\ngot %s", test.want, got)
			}
		})
	}
}
