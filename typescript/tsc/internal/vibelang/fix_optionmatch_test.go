package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"strings"
	"testing"
)

func TestOptionMatchNativeFoldkit(t *testing.T) {
	for _, source := range []string{
		"export const f = (v: Option.Option<number>): void => { Option.match(v, {onNone: ():number => 0, onSome: (n):number => n}) + 1; }",
		"export const f = (v: Option.Option<number>): void => { Option.match(v, {onNone: ():boolean => false, onSome: (n):boolean => n > 0}) ? 1 : 2; }",
		"export const f = (v: Option.Option<number>): void => { Option.match(v, {onNone: (): (() => void) => ():void => {}, onSome: (n): (() => void) => ():void => {}})(); }",

		"export const f = (v: Option.Option<number>): void => { Option.match(v, {onNone: ():void => {}, onSome: (n):void => {}}); }",
		"export const f = (v: Option.Option<number>): void => { if (true) Option.match(v, {onNone: ():void => {}, onSome: (n):void => {}}); }",
		"export const f = (v: Option.Option<number>): void => { (Option.match(v, {onNone: ():void => {}, onSome: (n):void => {}})); }",
		"export const f = (v: Option.Option<number>): number => Option.match(v, {onNone: ():number => 0, onSome: (n):number => n})",
		"export const f = (v: Option.Option<{a:number}>): number => Option.match(v, {onNone: ():number => 0, onSome: ({a}):number => { if (a) return a; return 2 }})",
		"export const f = (v: Option.Option<number>): number => { const $optionSubject = 4; return Option.match(v, {onSome:(n):number => n + $optionSubject, onNone:():number => 0}) }",
	} {
		fixed := applyQuickFix(t, source, EK4839.Code)
		if strings.Contains(fixed, "Option.match") || !strings.Contains(fixed, "when Option.Some(let ") {
			t.Fatalf("no native Option fix:\n%s", fixed)
		}
		p, f, _, _ := editorProgram(t, fixed)
		for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), f), p.GetSemanticDiagnostics(t.Context(), f)...) {
			if d.Category() == diagnostics.CategoryError {
				t.Errorf("fixed source: %s\n%s", d.String(), fixed)
			}
		}
	}
}

// RC-8 / effectscript-75: the existing advisory names Option, including aliases.
func TestOptionMatchDiagnosticAPI(t *testing.T) {
	for _, source := range []string{
		`import { Option } from "effect"; export const f = (v: Option.Option<number>): number => Option.match(v, { onNone: (): number => 0, onSome: (n): number => n });`,
		`import * as O from "effect/Option"; export const f = (v: O.Option<number>): number => O.match(v, { onNone: (): number => 0, onSome: (n): number => n });`,
	} {
		p, f, _, _ := editorProgram(t, source)
		found := false
		for _, d := range p.GetSemanticDiagnostics(t.Context(), f) {
			if d.Code() == EK4839.Code {
				found = true
				if !strings.Contains(d.String(), "Option.match chooses with Option's match API;") || strings.Contains(d.String(), "Effect's Match") {
					t.Errorf("wrong API in advisory: %s", d.String())
				}
			}
		}
		if !found {
			t.Fatalf("missing EK4839: %s", source)
		}
		fixed := applyQuickFix(t, source, EK4839.Code)
		if strings.Contains(fixed, ".match(") {
			t.Fatalf("direct choice was not fixed: %s", fixed)
		}
	}
}
