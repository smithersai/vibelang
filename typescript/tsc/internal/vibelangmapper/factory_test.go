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

func TestFactoryProjectionKeepsCallPhase(t *testing.T) {
	const source = `export const capture=(input:{value:number}): Effect.Effect<number,never,never> => { const snapshot=input.value; return () => snapshot }`
	for _, p := range []Projection{Project(source, testContext), Executable(source, testContext)} {
		snapshot := strings.Index(p.Text, "const snapshot")
		program := strings.Index(p.Text, "function*")
		if snapshot < 0 || program < snapshot {
			t.Fatalf("snapshot must precede generator: %s", p.Text)
		}
		if len(p.Diagnostics) > 0 {
			t.Fatalf("diagnostics: %v", p.Diagnostics)
		}
	}
}

func TestFactoryAliasKeepsCallPhase(t *testing.T) {
	const source = `import { Effect } from "effect"
type Made = Effect.Effect<number, never, never>
export const make=(n:number): Made => { const snapshot=n; return () => snapshot }
export const forward=(n:number): Made => { const program: Made=make(n); return program }
export function use(n:number) { const held: Made=make(n); return held() }`
	r := resolve(t, source)
	for _, site := range []string{"(n:number): Made => { const snapshot", "(n:number): Made => { const program"} {
		if d := r.lambda(t, site); d.Form != FormFactory {
			t.Fatalf("%s: %s, want factory", site, d.Form)
		}
	}
	if d := r.lambda(t, "() => snapshot"); d.Form != FormProgram {
		t.Fatalf("aliased factory return: %s, want program", d.Form)
	}
	for _, p := range []Projection{Project(source, testContext), Executable(source, testContext)} {
		if len(p.Diagnostics) != 0 {
			t.Fatalf("diagnostics: %v", p.Diagnostics)
		}
		makeStart, forwardStart := strings.Index(p.Text, "export const make="), strings.Index(p.Text, "export const forward=")
		if makeStart < 0 || forwardStart <= makeStart {
			t.Fatalf("missing factory declarations: %s", p.Text)
		}
		makeText := p.Text[makeStart:forwardStart]
		if snapshot, program := strings.Index(makeText, "const snapshot"), strings.Index(makeText, "function*"); snapshot < 0 || program < snapshot {
			t.Fatalf("alias must preserve call-time snapshot: %s", p.Text)
		}
		if !strings.Contains(p.Text, "const held: Made=make(n)") {
			t.Fatalf("alias must hold its initializer: %s", p.Text)
		}
	}
}

func TestFactoryImportedContextNeedsChoice(t *testing.T) {
	const source = `import type { Port } from "./port.js"; export const wrap=(base:Port):Port => ({ read: (path) => { const program: Effect.Effect<number> = base.read(path); return program } })`
	p := Project(source, testContext)
	found := false
	for _, d := range p.Diagnostics {
		if d.Code == CodeFormChoice && strings.Contains(d.Message, "D269") {
			found = true
		}
	}
	if !found {
		t.Fatalf("missing factory-context EK9005: %v\n%s", p.Diagnostics, p.Text)
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

func TestFactoryInferredChannels(t *testing.T) {
	const source = `export const make=(n:number): number!infer E!infer R => { const snapshot=n; return () => { if(snapshot<0) throw "bad"; return snapshot } }`
	checking := Project(source, testContext)
	if len(checking.Diagnostics) != 0 || !strings.Contains(checking.Text, "$contract<number") {
		t.Fatalf("%v\n%s", checking.Diagnostics, checking.Text)
	}
	js, _, diagnostics := Emit(source, testContext)
	if len(diagnostics) != 0 || strings.Contains(js, "$contract") || strings.Contains(js, "$Infer") {
		t.Fatalf("%v\n%s", diagnostics, js)
	}
}
