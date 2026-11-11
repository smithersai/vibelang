package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
)

// Recovery hovers describe the current language, even on rejected source.
func TestFiberRecoveryHoverGuidance(t *testing.T) {
	for _, operand := range []string{"Effect.succeed(1)", "pending", "program", "1", "fiber", "deferred", "select"} {
		t.Run(operand, func(t *testing.T) {
			body := "return await " + operand
			helper, title := "$await", "await"
			want := "In effect code, run Effects with `try`, join fibers with `join`, and wait for Deferreds with `try Deferred.await(deferred)`."
			if operand == "select" {
				body = "select { case Effect.succeed(1): return 1 }"
				helper, title = "$select", "select"
				want = "select is outside the first release (EK4607). Choose explicit Effect selection for the intended behavior."
			}
			source := `import { Effect, Fiber, Deferred } from "effect"
declare const pending: Promise<number>
declare const program: Effect.Effect<number>
declare const fiber: Fiber.Fiber<number>
declare const deferred: Deferred.Deferred<number>
export function read() { ` + body + " }"
			program, file, _, _ := editorProgram(t, source)
			c, done := program.GetTypeCheckerForFile(t.Context(), file)
			defer done()
			found := 0
			var visit func(*ast.Node) bool
			visit = func(n *ast.Node) bool {
				if fiberHelper(n) == helper {
					found++
					for _, node := range []*ast.Node{n, n.Expression()} {
						gotTitle, text := fiberFormQuickInfo(c, node)
						if gotTitle != title || !strings.Contains(text, want) {
							t.Errorf("hover: got %q, %q; want %q, %q", gotTitle, text, title, want)
						}
						for _, stale := range []string{"Waits for the operand", "try.race", "EK4609", "EK4610", "d.await()"} {
							if strings.Contains(text, stale) {
								t.Errorf("retired advice %q in %q", stale, text)
							}
						}
					}
				}
				return n.ForEachChild(visit)
			}
			file.AsNode().ForEachChild(visit)
			if found != 1 {
				t.Fatalf("found %d %s recovery nodes", found, helper)
			}
		})
	}
}
