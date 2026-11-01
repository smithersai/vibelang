package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestMatchDefaultDestructureFoldkit(t *testing.T) {
	for _, source := range []string{
		"export const f = (v: { a: number } | null): number => Match.value(v).pipe(Match.when(null, () => 0), Match.orElse(({ a }) => a))",
		"type Event = {_tag: 'A'} | {_tag:'B'}\nexport const f = (v: Event): string => Match.value(v).pipe(Match.tag('A', ():string => 'special'), Match.orElse(({ _tag }):string => _tag))",
		"export const f = (v: { a?: number } | null): number => Match.value(v).pipe(Match.when(null, () => 0), Match.orElse(({ a = 4 }) => a))",
		"export const f = (v: { a: number, b: number } | null): number => Match.value(v).pipe(Match.when(null, () => 0), Match.orElse(({ a: renamed, ...rest }) => renamed + rest.b))",
		"export const f = (v: { a: { b: number } } | null): number => Match.value(v).pipe(Match.when(null, () => 0), Match.orElse(({ a: { b } }) => b))",
		"export const f = (v: { a: number } | null): number => { const $matchDefault = 9; return Match.value(v).pipe(Match.when(null, () => 0), Match.orElse(({ a }) => a + $matchDefault)) }",
	} {
		fixed := applyQuickFix(t, source, EK4839.Code)
		if strings.Contains(fixed, "Match.orElse") {
			t.Fatalf("no destructuring fallback quick fix:\n%s", fixed)
		}
		p, f, _, _ := editorProgram(t, fixed)
		for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), f), p.GetSemanticDiagnostics(t.Context(), f)...) {
			if d.Category() == diagnostics.CategoryError {
				t.Errorf("fixed source: %s\n%s", d.String(), fixed)
			}
		}
	}
}

func TestMatchStringPrefixFoldkit(t *testing.T) {
	for _, source := range []string{
		"import * as S from 'effect/String'\nexport const f = (v: string): string => Match.value(v).pipe(Match.when(S.startsWith('Core'), () => '10'), Match.orElse(() => '0'))",
		"import * as S from 'effect/String'\nexport const f = (v: string): string => Match.value(v).pipe(Match.whenOr('Exact', S.startsWith('Core'), S.startsWith('Codec'), () => '10'), Match.orElse(() => '0'))",
		"export const f = (v: string): string => Match.value(v).pipe(Match.when(Effect.String.startsWith(''), () => '10'), Match.orElse(() => '0'))",
		"import * as S from 'effect/String'\nexport const f = (v: string): string => { const $matchString = 9; return Match.value(v).pipe(Match.when(S.startsWith('Core'), () => '' + $matchString), Match.orElse(() => '0')) }",
	} {
		fixed := applyQuickFix(t, source, EK4839.Code)
		if strings.Contains(fixed, "Match.when") {
			t.Fatalf("no prefix quick fix:\n%s", fixed)
		}
		p, f, _, _ := editorProgram(t, fixed)
		for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), f), p.GetSemanticDiagnostics(t.Context(), f)...) {
			if d.Category() == diagnostics.CategoryError {
				t.Errorf("fixed source: %s\n%s", d.String(), fixed)
			}
		}
	}
}
