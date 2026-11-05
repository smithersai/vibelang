package vibelangfuzz

import (
	"context"
	"strings"
	"testing"
)

const grammarSchemaDeclarationFieldsQuote = `SchemaDeclaration = SchemaStart "{" Field* "}"`

func TestGrammarAdmissionSchemaStaticQuoted(t *testing.T) {
	for _, quote := range []string{grammarSchemaDeclarationFieldsQuote, grammarSchemaFieldTypeQuote, grammarAdmissionQuote} {
		if !strings.Contains(SpecText(grammarAppendix), quote) {
			t.Fatalf("schema modifier authority changed: %s", quote)
		}
	}
}

func TestGrammarAdmissionSchemaStaticKeys(t *testing.T) {
	for source, want := range map[string]bool{
		"schema S { static id : Missing }":           true,
		"schema S { readonly static id: Missing }":   true,
		"schema S { static readonly id?: Missing }":  true,
		"schema S { static static id: Missing }":     true,
		"schema S { static 'id': Missing }":          true,
		"schema S { static [key]: Missing }":         true,
		"schema S { static async: Missing }":         true,
		"schema S = { static id: Missing };":         true,
		"schema S = ({ static id: Missing });":       true,
		"schema S { static: Missing }":               false,
		"schema S { readonly static?: Missing }":     false,
		"schema S { static m() {} }":                 false,
		"schema S { static get id() { return 1; } }": false,
		"schema S { static async id: Missing }":      false,
		"schema S { async static id: Missing }":      false,
		"schema error S { static id: Missing }":      false,
		"schema S { id: Missing }":                   false,
		"schema S = { static: Missing };":            false,
		"class S { static id: Missing }":             false,
		"interface S { static id: Missing }":         false,
		"obj.schema S { static id: Missing }":        false,
	} {
		if got := grammarAdmissionForm(source); (got == "admission:schema-static-field") != want {
			t.Errorf("key=%q,want static field=%v: %s", got, want, source)
		}
	}
	for _, source := range []string{
		"schema S { static async id: Missing }",
		"schema S = { async id: Missing };",
	} {
		if key := grammarAdmissionForm(source); key != "admission:schema-async-field" {
			t.Errorf("async modifier lost its separate family: key=%q,source=%s", key, source)
		}
	}
}

func TestGrammarAdmissionSchemaStaticRegression(t *testing.T) {
	w := NewWorkspace(t)
	for _, source := range []string{
		"schema S { static id : Missing }",
		"schema S { readonly static id: Missing }",
		"schema S { static readonly id?: Missing }",
		"schema S { static 'id': Missing }",
		"schema S { static async: Missing }",
		"schema S = { static id: Missing };",
		"schema S = ({ static id: Missing });",
	} {
		t.Run(source, func(t *testing.T) {
			result, err := w.Compile(context.Background(), Single(source))
			if err != nil {
				t.Fatal(err)
			}
			seen := false
			for _, d := range result.Diagnostics {
				seen = seen || IsEK(d) && d.Code() == 2109
			}
			if !seen || !grammarAdmissionVerdict(t, w, source) {
				t.Fatalf("static schema field lost the observed syntax diagnostic gap: %v", result.Diagnostics)
			}
		})
	}
	for _, source := range []string{
		"schema S { static static id: Missing }",
		"schema S { static: Missing }",
		"schema S { readonly static?: Missing }",
		"schema S { static id: string }",
		"schema S { static m() {} }",
		"schema error S { static id: string }",
		"schema S { id: Missing }",
		"schema S = { static: Missing };",
		"interface S { static id: Missing }",
		"class S { static id: Missing }",
	} {
		t.Run(source, func(t *testing.T) {
			if grammarAdmissionVerdict(t, w, source) {
				t.Fatal("valid or syntax-rejected control became an admission mismatch")
			}
		})
	}
}
