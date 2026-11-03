package vibelang

import (
	"fmt"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// A curried Effect.provide passed to pipe infers pipe's result, as in the
// same .ts (opencode core effect-sqlite driver: TS2345, "(_: Effect<…>) =>
// never"). The direct call always worked.
func TestProvidePipeInfersResult(t *testing.T) {
	for _, line := range []string{
		"export const a = e.pipe(Effect.provide(L))",
		"export const b = <T,>(c: T) => make(c).pipe(Effect.provide(L))",
		"const p = Effect.provide(L)\nexport const c = e.pipe(p)",
		"export const d = e.pipe(Effect.provide([L]))",
		"export const f = e.pipe(Effect.provide(L), Effect.map((n) => n + 1))",
		"export const g = Effect.provide(L)(e)",
	} {
		t.Run(line, func(t *testing.T) {
			source := `import { Effect, Layer } from "effect"
declare const e: Effect.Effect<number, never, "R">
declare const L: Layer.Layer<"R">
declare const make: <T>(c: T) => Effect.Effect<{ x: T }, never, "R">
` + line + "\n"
			program, file, _, _ := editorProgram(t, source)
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Category() == diagnostics.CategoryError {
					t.Errorf("%d: %s", d.Code(), d.String())
				}
			}
		})
	}
}

// Property: every pipe position of a curried Effect.provide, in every kind of
// .vibe function, compiles as its .ts twin does: without an error.
func FuzzProvidePipe(f *testing.F) {
	providers := []string{"Effect.provide(L)", "Effect.provide([L])", "Effect.provide(L, { local: true })", "p"}
	holders := []string{"export const h = %s", "export const h = <T,>(c: T) => %s", "export function h() { return %s }", "export const h = () => { const y = %s; return y }"}
	stages := []string{"e.pipe(%s)", "e.pipe(Effect.map((n) => n + 1), %s)", "e.pipe(%s, Effect.asVoid)"}
	for i := range 4 {
		f.Add(uint8(i), uint8(i), uint8(i))
	}
	f.Fuzz(func(t *testing.T, provider, holder, stage uint8) {
		call := fmt.Sprintf(stages[int(stage)%len(stages)], providers[int(provider)%len(providers)])
		source := `import { Effect, Layer } from "effect"
declare const e: Effect.Effect<number, never, "R">
declare const L: Layer.Layer<"R">
const p = Effect.provide(L)
` + fmt.Sprintf(holders[int(holder)%len(holders)], call) + "\n"
		program, file, _, _ := editorProgram(t, source)
		for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
			if d.Category() == diagnostics.CategoryError {
				t.Errorf("%d: %s\n%s", d.Code(), d.String(), source)
			}
		}
	})
}
