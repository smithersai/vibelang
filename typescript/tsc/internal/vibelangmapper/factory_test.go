package vibelangmapper

import (
	"strings"
	"testing"
)

func TestFactoryForms(t *testing.T) {
	r := resolve(t, `import { Effect } from "effect"
 export const capture=(n:number): Effect.Effect<number,never,never> => { const snapshot=n; return () => snapshot }
 export const bound: (n:number) => Effect.Effect<number> = n => () => n
 export function declared(n:number): number!! { return () => n }
 export function nested(migration: Effect.Effect<void>) { const load: Effect.Effect<Effect.Effect<void>> = () => migration; return load }
 `)
	for _, test := range []struct {
		text string
		form Form
	}{
		{"(n:number): Effect", FormFactory}, {"() => snapshot", FormProgram}, {"n => () => n", FormFactory}, {"() => n }", FormProgram}, {"() => migration", FormProgram},
	} {
		if d := r.lambda(t, test.text); d.Form != test.form {
			t.Errorf("%s: %s, want %s", test.text, d.Form, test.form)
		}
	}
}

func TestFactoryHatchKeepsTypeScript(t *testing.T) {
	const source = `export function main() { return sync(() => { const factory=(): Effect.Effect<number> => () => 1; return factory }) }`
	r := resolve(t, source)
	if d := r.lambda(t, "(): Effect.Effect<number>"); d.Form != FormPlain || d.Provenance != FromHatch {
		t.Fatalf("hatch factory: %v", d)
	}
}

func TestFactoryKeepsAcceptedFunctionValues(t *testing.T) {
	for _, success := range []string{"() => number", "object", "unknown", "{}", "number | (() => number)"} {
		r := resolve(t, `export const target=(): Effect.Effect<`+success+`,never,never> => () => 1`)
		if d := r.lambda(t, "(): Effect.Effect"); d.Form == FormFactory {
			t.Errorf("%s already accepts a function value", success)
		}
	}
}

func TestFactoryReturnedFunctionUsesSuccessSignature(t *testing.T) {
	for _, test := range []struct {
		success string
		form    Form
	}{
		{"() => number", FormPlain},
		{"number | (() => number)", FormPlain},
		{"Value", FormPlain},
		{"() => Effect.Effect<number>", FormEffectFn},
		{"Effect.Effect<number>", FormProgram},
	} {
		r := resolve(t, `type Value = () => number
export function target(): Effect.Effect<`+test.success+`, never, never> { return () => 3 }`)
		if d := r.lambda(t, "() => 3"); d.Form != test.form {
			t.Errorf("success %s: %s, want %s", test.success, d.Form, test.form)
		}
	}
}

// TestEffectArrowInferredChannels projects a written effect arrow whose
// return annotation infers its error and requirement channels: the checking
// rendering pins them with $contract and keeps the arrow, and the executable rendering erases
// every channel helper and still parses.
func TestEffectArrowInferredChannels(t *testing.T) {
	const source = `export const make = effect (n: number): number!infer E!infer R => { if (n < 0) throw "bad"; return n }`
	checking := Project(source, testContext)
	if len(checking.Diagnostics) != 0 || !strings.Contains(checking.Text, "$contract<number") || !strings.Contains(checking.Text, "=>") {
		t.Fatalf("%v\n%s", checking.Diagnostics, checking.Text)
	}
	js, _, diagnostics := Emit(source, testContext)
	if len(diagnostics) != 0 || strings.Contains(js, "$contract") || strings.Contains(js, "$Infer") || !strings.Contains(js, "$fail(\"bad\")") {
		t.Fatalf("%v\n%s", diagnostics, js)
	}
}
