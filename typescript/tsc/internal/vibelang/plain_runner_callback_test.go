package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"testing"
)

// VIP-1: a callback without effect remains TypeScript, including when the
// caller is Effect code. Returned and argument callbacks have the same kind.
func TestPlainRunnerCallbackBoundaries(t *testing.T) {
	for _, tc := range []struct {
		name, body     string
		want, promises int
	}{
		{"argument", "const transform = (f: () => void) => f(); transform(() => { run(Effect.void) });", 0, 0},
		{"returned", "return () => run(Effect.void);", 0, 0},
		{"assigned", "const f = () => run(Effect.void); f();", 0, 0},
		{"named", "function f() { run(Effect.void) }; f();", 0, 0},
		{"async", "const transform = (f: () => Promise<void>) => f(); transform(async () => { run(Effect.void) });", 0, 1},
		{"async-wrapped", "const transform = (f: () => Promise<void>) => f(); try tryPromise(() => transform(async () => { run(Effect.void) }));", 0, 0},
		{"nested", "const transform = (f: () => void) => f(); transform(() => transform(() => { run(Effect.void) }));", 0, 0},
		{"explicit-effect", "const f = effect () => { run(Effect.void) };", 1, 0},
		{"direct-effect", "run(Effect.void);", 1, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			source := "export const a = effect { const run = Effect.runSyncWith(try Effect.context<never>()); " + tc.body + " }\n"
			p, file, _, _ := editorProgram(t, source)
			n, promises := 0, 0
			for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), file), p.GetSemanticDiagnostics(t.Context(), file)...) {
				if d.Code() == 1005 {
					n++
				} else if d.Code() == EK0404.Code {
					promises++
				} else if d.Category() == diagnostics.CategoryError {
					t.Errorf("unexpected diagnostic: %s", d.String())
				}
			}
			if promises != tc.promises {
				t.Fatalf("EK0404 count %d, want %d\n%s", promises, tc.promises, source)
			}
			if n != tc.want {
				t.Fatalf("EK1005 count %d, want %d\n%s", n, tc.want, source)
			}
		})
	}
}
