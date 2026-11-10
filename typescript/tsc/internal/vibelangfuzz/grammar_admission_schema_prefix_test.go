package vibelangfuzz

import (
	"context"
	"testing"
)

// Modifier names remain property names when immediately followed by a method
// head; only a preceding readonly modifier belongs to the TS1024 family.
func TestGrammarAdmissionSchemaModifierMethodKeys(t *testing.T) {
	for source, want := range map[string]string{
		"schema S = { static readonly id() }":           "admission:schema-readonly-method",
		"schema S = { async readonly id() }":            "admission:schema-readonly-method",
		"schema S = { readonly effect fork() }":         "admission:schema-readonly-method",
		"schema S = { static\nreadonly id<T>(): T }":    "admission:schema-readonly-method",
		"schema S = { readonly static id?() }":          "admission:schema-readonly-method",
		"schema S = { a: string; async readonly id() }": "admission:schema-readonly-method",
		"schema S = { readonly [key]() }":               "admission:schema-readonly-method",
		"schema S = { readonly ['id']?() }":             "admission:schema-readonly-method",
		"schema S = { readonly async() }":               "admission:schema-readonly-method",
		"schema S = { static readonly() }":              "admission:schema-static-method",
		"schema S = { readonly() }":                     "",
		"schema S = { readonly: Missing }":              "",
		"schema S = { readonly\nid() }":                 "",
		"schema S = { async\nreadonly() }":              "",
		"schema S { readonly id() }":                    "",
		"schema error E { readonly id() }":              "",
		"type S = { readonly id() }":                    "",
		"schema S = { a: { readonly id() } }":           "",
	} {
		if got := grammarAdmissionForm(source); got != want {
			t.Errorf("key=%q, want %q: %q", got, want, source)
		}
	}
}

func TestGrammarAdmissionSchemaLiteralInitializerKeys(t *testing.T) {
	for source, want := range map[string]bool{
		"schema S = { 1 ? = Missing }":             true,
		"schema S = { 1 = Missing }":               true,
		"schema S = { 'id' = Missing }":            true,
		"schema S = { 'id'? = Missing }":           true,
		"schema S = { a: string; 1 = Missing }":    true,
		"schema S = { [key] = Missing }":           true,
		"schema S = { ['id']? = Missing }":         true,
		"schema S = { 1: Missing }":                false,
		"schema S = { 'id'?: Missing }":            false,
		"schema S = { f: (x: string) => Missing }": false,
		"schema S = { id(): Missing }":             false,
		"type S = { 1 = Missing }":                 false,
	} {
		got := grammarAdmissionForm(source)
		if (got == "admission:schema-field-initializer") != want {
			t.Errorf("key=%q, want initializer=%v: %q", got, want, source)
		}
	}
}

func TestGrammarAdmissionSchemaPrefixRegression(t *testing.T) {
	w := NewWorkspace(t)
	// A modifier prefix on an alias method keeps TS1070, TS1024 or EK0108
	// beside the EK2109 of the unsupported member: no admission gap.
	for _, source := range []string{
		"schema S = { static readonly id() }",
		"schema S = { async readonly id() }",
		"schema S = { readonly effect fork() }",
	} {
		t.Run(source, func(t *testing.T) {
			if grammarAdmissionVerdict(t, w, source) {
				r, _ := w.Compile(context.Background(), Single(source))
				t.Fatalf("a rejected alias method is an admission gap: %v", r.Diagnostics)
			}
		})
	}
	// A numeric untyped member with an initializer keeps TS1247 beside EK2109.
	t.Run("numeric untyped initializer", func(t *testing.T) {
		source := "schema S = { 1 ? = Missing }"
		if grammarAdmissionVerdict(t, w, source) {
			r, _ := w.Compile(context.Background(), Single(source))
			t.Fatalf("a rejected alias member is an admission gap: %v", r.Diagnostics)
		}
	})
}

func TestGrammarAdmissionSchemaSignatureKeys(t *testing.T) {
	for source, want := range map[string]string{
		"schema S = { async readonly (\n) }":                          "admission:schema-async-method",
		"schema S = { async id() }":                                   "admission:schema-async-method",
		"schema S = { async id<T>(): T }":                             "admission:schema-async-method",
		"schema S = { async [key]() }":                                "admission:schema-async-method",
		"schema S = { async() }":                                      "",
		"schema S = { async\nid() }":                                  "",
		"schema S { async id() }":                                     "",
		"type S = { async id() }":                                     "",
		"schema S = { readonly; (static static) }":                    "admission:schema-signature-parameter-modifier",
		"schema S = { (static value: Missing): Missing }":             "admission:schema-signature-parameter-modifier",
		"schema S = { f(readonly value: Missing): Missing }":          "admission:schema-signature-parameter-modifier",
		"schema S = { f(value: number, public x: Missing): Missing }": "admission:schema-signature-parameter-modifier",
		"schema S = { (value: Missing): Missing }":                    "",
		"schema S = { (static: Missing): Missing }":                   "admission:schema-signature-reserved-binding",
		"type S = { (static static) }":                                "",
		"schema S = { fork:\nasync\nasync Missing\n}":                 "admission:schema-async-field",
	} {
		if got := grammarAdmissionForm(source); got != want {
			t.Errorf("key=%q, want %q: %q", got, want, source)
		}
	}
}

func TestGrammarAdmissionSchemaSignatureRegression(t *testing.T) {
	w := NewWorkspace(t)
	// A readonly call signature keeps TS1024 beside EK2109: no admission gap.
	t.Run("readonly call signature", func(t *testing.T) {
		source := "schema S = { async readonly (\n) }"
		if grammarAdmissionVerdict(t, w, source) {
			r, _ := w.Compile(context.Background(), Single(source))
			t.Fatalf("a rejected alias signature is an admission gap: %v", r.Diagnostics)
		}
	})
	for _, source := range []string{
		"schema S = { readonly; (static static) }",
	} {
		t.Run(source, func(t *testing.T) {
			if grammarAdmissionVerdict(t, w, source) {
				r, _ := w.Compile(context.Background(), Single(source))
				t.Fatalf("a rejected signature parameter is an admission gap: %v", r.Diagnostics)
			}
		})
	}
	// A typed field after an untyped async member keeps its TS1070 beside
	// the EK2109 of its unresolved type: no admission gap.
	t.Run("typed last alias field", func(t *testing.T) {
		source := "schema S = { fork:\nasync\nasync Missing\n}"
		if grammarAdmissionVerdict(t, w, source) {
			r, _ := w.Compile(context.Background(), Single(source))
			t.Fatalf("a rejected alias field is an admission gap: %v", r.Diagnostics)
		}
	})
}

func TestGrammarAdmissionSchemaStaticMethodKeys(t *testing.T) {
	for source, want := range map[string]string{
		"schema S =\n{ static id() }":         "admission:schema-static-method",
		"schema S = { static id<T>(): T }":    "admission:schema-static-method",
		"schema S = { static\nid() }":         "admission:schema-static-method",
		"schema S = { static [key]?() }":      "admission:schema-static-method",
		"schema S = { static readonly() }":    "admission:schema-static-method",
		"schema S = { static() }":             "",
		"schema S { static id() }":            "",
		"schema error E { static id() }":      "",
		"type S = { static id() }":            "",
		"schema S = { a: { static id() } }":   "",
		"schema S = { static readonly id() }": "admission:schema-readonly-method",
		"schema S = { static async id() }":    "admission:schema-async-method",
	} {
		if got := grammarAdmissionForm(source); got != want {
			t.Errorf("key=%q, want %q: %q", got, want, source)
		}
	}
}

func TestGrammarAdmissionSchemaStaticMethodRegression(t *testing.T) {
	w := NewWorkspace(t)
	// A static alias method keeps TS1070 beside EK2109: no admission gap.
	const source = "schema S =\n{ static id() }"
	if grammarAdmissionVerdict(t, w, source) {
		r, _ := w.Compile(context.Background(), Single(source))
		t.Fatalf("a rejected alias method is an admission gap: %v", r.Diagnostics)
	}
}
