package vibelangfuzz

import (
	"context"
	"testing"
)

// Object-type alias members whose native rejection an unresolved or
// unsupported schema mapping covers with EK2109, and a type assertion's
// dangling EffectType bang.
func TestGrammarAdmissionSchemaAliasMemberKeys(t *testing.T) {
	for source, want := range map[string]string{
		// TS1024: readonly only on a property or index signature.
		"schema S = { readonly id ( ) }":          "admission:schema-readonly-method",
		"schema S\n= { readonly id ( )\n}":        "admission:schema-readonly-method",
		"schema S = { readonly id?(): string }":   "admission:schema-readonly-method",
		"schema S = { readonly id<T>(): T }":      "admission:schema-readonly-method",
		"schema S = { a: string; readonly id() }": "admission:schema-readonly-method",
		"schema S = { readonly readonly id ( ) }": "admission:schema-duplicate-readonly",
		"schema S = { readonly id: string }":      "",
		"schema S = { readonly\nid() }":           "",
		"schema S = { id() }":                     "",
		"schema S { readonly id() }":              "",
		"type S = { readonly id() };":             "",
		// TS1247: a type literal property has no initializer.
		"schema S = { id ? = Missing }":            "admission:schema-field-initializer",
		"schema S = { async ? =\nMissing\n}":       "admission:schema-field-initializer",
		"schema S = { id = Missing }":              "admission:schema-field-initializer",
		"schema S = { a: string; id = 1 }":         "admission:schema-field-initializer",
		"schema S = { key : Missing = \"k\" }":     "admission:schema-field-initializer",
		"schema S = { f: (x: string) => Missing }": "",
		"type S = { id ? = Missing };":             "",
		// VIP-3 EffectType inside an angle-bracket assertion or type arguments.
		"x = <number ! string !> y;":          "admission:effect-type-trailing-bang",
		"< number ! string ! > y":             "admission:effect-type-trailing-bang",
		"{ <\nnumber ! string ! >\nboolean }": "admission:effect-type-trailing-bang",
		"x = <number ! string> y;":            "",
		"x = <number !!> y;":                  "",
		"x = 1 < number ! string ! > ;":       "admission:effect-type-trailing-bang",
		"f<A ! B !>();":                       "admission:effect-type-trailing-bang",
	} {
		if got := grammarAdmissionForm(source); got != want {
			t.Errorf("key=%q, want %q: %q", got, want, source)
		}
	}
}

func TestGrammarAdmissionSchemaAliasMemberRegression(t *testing.T) {
	w := NewWorkspace(t)
	// A readonly method keeps TS1024 beside the EK2109 of the unsupported
	// member: no admission gap.
	for _, source := range []string{
		"schema S = { readonly id ( ) }",
		"schema S\n= { readonly id ( )\n}",
	} {
		t.Run(source, func(t *testing.T) {
			if grammarAdmissionVerdict(t, w, source) {
				result, _ := w.Compile(context.Background(), Single(source))
				t.Fatalf("a rejected alias method is an admission gap; diagnostics=%v", result.Diagnostics)
			}
		})
	}
	for _, source := range []string{
		"schema S = { id ? = Missing }",
		"schema S = { async ? =\nMissing\n}",
		"< number ! string ! > y",
		"{ <\nnumber ! string ! >\nboolean }",
		"x = 1 < number ! string ! > ;",
	} {
		t.Run(source, func(t *testing.T) {
			if !grammarAdmissionVerdict(t, w, source) {
				result, _ := w.Compile(context.Background(), Single(source))
				t.Fatalf("witness no longer exposes an admission gap; diagnostics=%v", result.Diagnostics)
			}
		})
	}
}
