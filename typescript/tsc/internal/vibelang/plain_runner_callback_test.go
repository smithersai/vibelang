package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"testing"
)

// VIP-1: a callback without effect remains TypeScript, including when the
// caller is Effect code. Returned and argument callbacks have the same kind.
func TestPlainRunnerCallbackBoundaries(t *testing.T) {
	for _, tc := range []struct {
		name, body string
		want       int
	}{
		{"argument", "const transform = (f: () => void) => f(); transform(() => { run(Effect.void) });", 0},
		{"returned", "return () => run(Effect.void);", 0},
		{"assigned", "const f = () => run(Effect.void); f();", 0},
		{"named", "function f() { run(Effect.void) }; f();", 0},
		{"async", "const transform = (f: () => Promise<void>) => f(); transform(async () => { run(Effect.void) });", 0},
		{"nested", "const transform = (f: () => void) => f(); transform(() => transform(() => { run(Effect.void) }));", 0},
		{"explicit-effect", "const f = effect () => { run(Effect.void) };", 1},
		{"direct-effect", "run(Effect.void);", 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			source := "export const a = effect { const run = Effect.runSyncWith(try Effect.context<never>()); " + tc.body + " }\n"
			p, file, _, _ := editorProgram(t, source)
			n := 0
			for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), file), p.GetSemanticDiagnostics(t.Context(), file)...) {
				if d.Code() == 1005 {
					n++
				} else if d.Category() == diagnostics.CategoryError {
					t.Errorf("unexpected diagnostic: %s", d.String())
				}
			}
			if n != tc.want {
				t.Fatalf("EK1005 count %d, want %d\n%s", n, tc.want, source)
			}
		})
	}
}
