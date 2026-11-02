package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// VIP-1 and decided detail303: an Effect return type cannot relabel a plain
// factory or reject its value at a TypeScript-compatible destination.
func TestEffectFactoriesAreOrdinaryValues(t *testing.T) {
	head := "const make = (): Effect.Effect<number> => Effect.succeed(7);\n"
	for _, source := range []string{
		"export const f: () => void = make",
		"export const f: () => any = make",
		"export const f: () => unknown = make",
		"export const f: Function = make",
		"export const fs: ReadonlyArray<() => void> = [make]",
		"export const item: { make(): void } = { make }",
		"class Box { make() { return Effect.succeed(7) } }; export const item: { make(): void } = new Box()",
		"export const f: () => void = effect () => 7",
		"const take = <T extends ((id: string) => any) | { kind: string }>(f: T) => 1; export const n = take(make)",
		"const take = <T>(f: ((id: string) => any) | { kind: T }) => 1; export const n = take(make)",
	} {
		t.Run(source, func(t *testing.T) {
			p, file, _, _ := editorProgram(t, head+source)
			for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), file), p.GetSemanticDiagnostics(t.Context(), file)...) {
				if d.Category() == diagnostics.CategoryError {
					t.Fatalf("ordinary factory value rejected: %s", d.String())
				}
			}
		})
	}
}

func TestEffectFactoryKeepsNativeReturnMismatch(t *testing.T) {
	source := "const make = (): Effect.Effect<number> => Effect.succeed(7);\nexport const wrong: () => number = make"
	p, file, _, _ := editorProgram(t, source)
	count := 0
	for _, d := range p.GetSemanticDiagnostics(t.Context(), file) {
		if d.Category() != diagnostics.CategoryError {
			continue
		}
		if d.Source() != "" || d.Code() != 2322 || !strings.Contains(d.String(), "number") {
			t.Fatalf("expected only native TS2322, got %s", d.String())
		}
		count++
	}
	if count != 1 {
		t.Fatalf("native return mismatch count %d; want 1", count)
	}
}
