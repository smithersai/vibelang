package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"strings"
	"testing"
)

// 007: a quick fix preserves coldness as well as the choice's value.
func TestOptionMatchProgramFix(t *testing.T) {
	for _, source := range []string{
		"export function choose(v: Option.Option<number>): Effect.Effect<number> { return Option.match(v, {onNone: () => Effect.succeed(0), onSome: n => Effect.succeed(n)}) }",
		"export effect function choose(v: Option.Option<number>) { return try Option.match(v, {onNone: () => Effect.succeed(0), onSome: n => Effect.succeed(n)}) }",
		"export function choose(v: Option.Option<number>) { return Option.match(v, {onNone: () => Effect.fail('missing'), onSome: n => Effect.succeed(n)}) }",
		"export function choose(v: Option.Option<number>) { return Option.match(v, {onNone: effect () => 0, onSome: effect n => n}) }",
		"export effect function choose(v: Option.Option<number>) { try Option.match(v, {onNone: () => Effect.void, onSome: n => Effect.fail(n)}); return 0 }",
	} {
		fixed := applyQuickFix(t, source, EK4839.Code)
		if strings.Contains(fixed, "Option.match(") || !strings.Contains(fixed, "when Option.Some(") {
			t.Fatalf("program choice was not fixed:\n%s", fixed)
		}
		// try on the do expression would leave its program unrun (EK4801).
		if tried := strings.Contains(source, "try Option.match("); tried != (strings.Contains(fixed, "try $optionSome(") && strings.Contains(fixed, "try $optionNone()")) || strings.Contains(fixed, "try (") {
			t.Fatalf("try must run the selected arm's program, and only when the original ran it:\n%s", fixed)
		}
		p, f, _, _ := editorProgram(t, fixed)
		for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), f), p.GetSemanticDiagnostics(t.Context(), f)...) {
			if d.Category() == diagnostics.CategoryError {
				t.Errorf("%s\n%s", d.String(), fixed)
			}
		}
	}
}
