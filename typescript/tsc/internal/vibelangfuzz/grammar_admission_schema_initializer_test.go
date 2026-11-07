package vibelangfuzz

import (
	"context"
	"testing"
)

var grammarSchemaInitializerModifierGaps = []string{
	"schema S = { readonly 1 ? =\nMissing }",
	"schema S = { readonly 1 ? = Missing }",
	"schema S = { readonly 'id' ? = Missing }",
	"schema S = { readonly id ? = Missing }",
	"schema S = { a: string; readonly 1 ? = Missing }",
}

// The non-optional spellings after a modifier are already syntax errors, as is
// a static type member; the type-alias twins keep native TS1247.
var grammarSchemaInitializerModifierControls = []string{
	"schema S = { readonly 1 = Missing }",
	"schema S = { readonly 'id' = Missing }",
	"schema S = { readonly id = Missing }",
	"schema S = { static [k] = Missing }",
	"type S = { readonly 1 ? = Missing }",
	"type S = { readonly id ? = Missing }",
}

// A field initializer is native TS1247 in a type literal. After a modifier
// prefix an optional alias member still reaches it, and schema mapping
// reports only EK2109.
func TestGrammarAdmissionSchemaInitializerModifierKeys(t *testing.T) {
	for _, source := range grammarSchemaInitializerModifierGaps {
		if got := grammarAdmissionForm(source); got != "admission:schema-field-initializer" {
			t.Errorf("key=%q, want admission:schema-field-initializer: %q", got, source)
		}
	}
	for source, want := range map[string]string{
		"schema S = { readonly = Missing }":    "admission:schema-field-initializer",
		"schema S = { readonly 1 = Missing }":  "",
		"schema S = { readonly id = Missing }": "",
		"schema S = { readonly 1: Missing }":   "",
		"type S = { readonly 1 ? = Missing }":  "",
	} {
		if got := grammarAdmissionForm(source); got != want {
			t.Errorf("key=%q, want %q: %q", got, want, source)
		}
	}
}

func TestGrammarAdmissionSchemaInitializerModifierRegression(t *testing.T) {
	w := NewWorkspace(t)
	for _, source := range grammarSchemaInitializerModifierGaps {
		t.Run(source, func(t *testing.T) {
			if !grammarAdmissionVerdict(t, w, source) {
				r, _ := w.Compile(context.Background(), Single(source))
				t.Fatalf("witness no longer exposes an admission gap: %v", r.Diagnostics)
			}
			checkGrammarAdmission(t, w, grammarAdmissionMutationKey(source), source)
		})
	}
	for _, source := range grammarSchemaInitializerModifierControls {
		t.Run(source, func(t *testing.T) {
			if grammarAdmissionVerdict(t, w, source) {
				t.Fatalf("control became an admission gap: %q", source)
			}
		})
	}
}
