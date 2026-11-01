package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"strings"
	"testing"
)

// Tooling chapter 007: a quick fix preserves types and declaration output.
// Foldkit's lint prohibits assertions; withReturnType must stay a checked type.
func TestMatchNoAssertionFoldkit(t *testing.T) {
	for _, source := range []string{
		"type View = { model: number; commands?: readonly string[] }; export const f = (n: number) => Match.value(n).pipe(Match.withReturnType<View>(), Match.when(1, () => ({model: 1, commands: [\"one\"]})), Match.orElse(() => ({model: 2, commands: undefined})))",
		"type View = { model: number; commands?: readonly string[] }; export function f(n: number) { const {model, commands} = Match.value(n).pipe(Match.withReturnType<View>(), Match.when(1, () => ({model: 1, commands: [\"one\"]})), Match.orElse(() => ({model: 2, commands: undefined}))); return {model, commands} }",
		"type View = { model: number; commands?: readonly string[] }; export function f(n: number): View { return Match.value(n).pipe(Match.withReturnType<View>(), Match.when(1, () => ({model: 1, commands: [\"one\"]})), Match.orElse(() => ({model: 2, commands: undefined}))) }",
		"type View = { model: number; commands?: readonly string[] }; export function f(n: number) { const $matchResult = {model: 9}; return [$matchResult, Match.value(n).pipe(Match.withReturnType<View>(), Match.when(1, () => ({model: 1, commands: [\"one\"]})), Match.orElse(() => ({model: 2, commands: undefined})))] }",
		"type View = { model: number; commands?: readonly string[] }; export function f(n: number) { const {model} = (Match.value(n).pipe(Match.withReturnType<View>(), Match.when(1, () => ({model: 1, commands: [\"one\"]})), Match.orElse(() => ({model: 2, commands: undefined})))); return model }",
	} {
		got := applyQuickFix(t, source+"\n", EK4839.Code)
		if strings.Contains(got, " as View") || strings.Contains(got, "Match.value") {
			t.Fatalf("expected a native match with a checked annotation:\n%s", got)
		}
		program, file, _, _ := editorProgram(t, got)
		for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
			if d.Category() == diagnostics.CategoryError {
				t.Errorf("fixed source: %s%d: %s\n%s", d.Source(), d.Code(), d.String(), got)
			}
		}
	}
}
