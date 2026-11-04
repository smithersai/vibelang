package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// RC-18 / VIP-34: a handler's binding cannot add tests to its predicate.
func TestMatchHandlerDestructure(t *testing.T) {
	for _, test := range []struct{ name, source string }{
		{"missing", "export const f = (v: {kind:string; payload?:string}):string => Match.value(v).pipe(Match.when({kind:'hit'}, ({payload}):string => payload ?? 'empty'), Match.orElse(():string => 'miss'))"},
		{"tag", "export const f = (v: {_tag:'Hit'; payload?:string}|{_tag:'Miss'}):string => Match.value(v).pipe(Match.tag('Hit', ({payload}):string => payload ?? 'empty'), Match.orElse(():string => 'miss'))"},
		{"default", "export const f = (v: {kind:string; payload?:string}):string => Match.value(v).pipe(Match.when({kind:'hit'}, ({payload = 'empty'}):string => payload), Match.orElse(():string => 'miss'))"},
		{"nested", "export const f = (v: {kind:string; box?:{payload?:string}}):string => Match.value(v).pipe(Match.when({kind:'hit'}, ({box:{payload = 'empty'} = {}}):string => payload), Match.orElse(():string => 'miss'))"},
		{"rest", "export const f = (v: {kind:string; payload?:string}):string => Match.value(v).pipe(Match.when({kind:'hit'}, ({kind, ...rest}):string => rest.payload ?? kind), Match.orElse(():string => 'miss'))"},
		{"fallback assignment", "export const f = (v: {kind:string; payload?:string}):string => Match.value(v).pipe(Match.when({kind:'hit'}, ():string => 'hit'), Match.orElse(({payload = 'old'}):string => { payload = 'new'; return payload }))"},
		{"type builder", "export const f = Match.type<{kind:string;payload?:string}>().pipe(Match.when({kind:'hit'}, ({payload = 'empty'}):string => payload), Match.orElse(():string => 'miss'))"},
		{"assignment", "export const f = (v: {kind:string; payload?:string}):string => Match.value(v).pipe(Match.when({kind:'hit'}, ({payload = 'old'}):string => { payload = 'new'; return payload }), Match.orElse(():string => 'miss'))"},
		{"computed", "export const f = (v: {kind:string; payload?:string}):string => Match.value(v).pipe(Match.when({kind:'hit'}, ({['payload']:payload = 'empty'}):string => payload), Match.orElse(():string => 'miss'))"},
		{"primitive", "export const f = (v:string|number):number => Match.value(v).pipe(Match.when(Match.string, ({length}):number => length), Match.orElse(():number => -1))"},
		{"collision", "export const f = (v: {kind:string; payload?:string}):string => { const $matchHandler = 'outer'; return Match.value(v).pipe(Match.when({kind:'hit'}, ({payload = $matchHandler}):string => payload), Match.orElse(():string => 'miss')) }"},
		{"parameter scope", "export const f = (v: {kind:string; payload?:string}):string => { const fallback = 'outer'; return Match.value(v).pipe(Match.when({kind:'hit'}, ({payload = fallback}):string => { const fallback = 'inner'; return payload + fallback }), Match.orElse(():string => 'miss')) }"},
	} {
		t.Run(test.name, func(t *testing.T) {
			fixed := applyQuickFix(t, test.source, EK4839.Code)
			if !strings.Contains(fixed, "do { let {") || strings.Contains(fixed, "Match.value") {
				t.Fatalf("handler must destructure only in its selected body:\n%s", fixed)
			}
			p, f, _, _ := editorProgram(t, fixed)
			for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), f), p.GetSemanticDiagnostics(t.Context(), f)...) {
				if d.Category() == diagnostics.CategoryError {
					t.Errorf("%s\n%s", d.String(), fixed)
				}
			}
		})
	}
}

// Removing a handler activation must not let var or direct eval observe its
// caller's function environment. An uncertain scope keeps its refusal.
func TestMatchHandlerDestructureScopeRefusals(t *testing.T) {
	for _, test := range []struct{ body, why string }{
		{"{ var privateValue = payload; return privateValue }", "function scope"},
		{"{ return eval('payload') }", "eval"},
		{"{ const read = () => eval('payload'); return read() }", "eval"},
	} {
		source := "export const f = (v:{kind:string;payload?:string}):string => Match.value(v).pipe(Match.when({kind:'hit'}, ({payload = 'empty'}):string => " + test.body + "), Match.orElse(():string => 'miss'))"
		p, f, _, _ := editorProgram(t, source)
		found := false
		for _, d := range p.GetSemanticDiagnostics(t.Context(), f) {
			if d.Source() != diagnosticSource || d.Code() != EK4839.Code {
				continue
			}
			for _, note := range d.MessageChain() {
				if strings.Contains(note.String(), "No quick fix") && strings.Contains(note.String(), test.why) {
					found = true
				}
			}
		}
		if !found {
			t.Fatalf("missing scope refusal for %s", source)
		}
	}
}

// VIP-1/VIP-5: constructing an Effect in a plain handler binding stays data.
func TestMatchHandlerDestructureEffectInitializer(t *testing.T) {
	source := "export const f = (v:{kind:string;payload?:unknown}):string => Match.value(v).pipe(Match.when({kind:'hit'}, ({payload = Effect.succeed('empty')}):string => 'unused'), Match.orElse(():string => 'miss'))"
	fixed := applyQuickFix(t, source, EK4839.Code)
	if !strings.Contains(fixed, "let {payload = Effect.succeed('empty')}") {
		t.Fatalf("Effect initializer must remain an ordinary binding initializer:\n%s", fixed)
	}
}
