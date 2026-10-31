package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"testing"
)

func TestNativePreludeWithoutRuntime(t *testing.T) {
	for _, source := range []string{
		"export const value = Effect",
		"export const value = Layer",
		"export const value = Schema",
		"export const value = Scope",
		"export const value = Effect.runSync(Effect.succeed(7))",
		"export type API = typeof Layer\nexport declare const value: API",
		"export declare const load: (id: string) => number!!",
		"const Effect = { local: 7 as const }\nexport const value: 7 = Effect.local",
		"import { Effect as Fx } from 'effect'\nexport const value = Fx.runSync(Fx.succeed(7))",
	} {
		t.Run(source, func(t *testing.T) {
			program, file, _, _ := editorProgramWith(t, source, map[string]string{"effect": "packages/runtime/node_modules/effect"})
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Category() == diagnostics.CategoryError {
					t.Fatalf("native Effect source requires an unrelated runtime package: %s", diagnosticWithNotes(d))
				}
			}
		})
	}
}
