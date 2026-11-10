package vibelangfuzz

import (
	"context"
	"testing"
)

var grammarSignatureModifierGaps = []string{
	"schema S = { ( async { p : static } : Missing ) : Missing }",
	"schema S = { (async {p}: Missing): Missing }",
	"schema S = { (async p: Missing): Missing }",
	"schema S = { (async [p]: Missing): Missing }",
	"schema S = { (async ...p: Missing[]): Missing }",
	"schema S = { (static {p}: Missing): Missing }",
	"schema S = { (static\n{p}: Missing): Missing }",
	"schema S = { (readonly [p]: Missing): Missing }",
	"schema S = { (public ...p: Missing[]): Missing }",
	"schema S = { f(async {p}: Missing): Missing }",
	"schema S = { (x: Missing, async {p}: Missing): Missing }",
}

// TypeScript reads a parameter modifier before a name, binding pattern or
// rest parameter and rejects async there with TS1090. A parameter named
// async, and async before a line break, are not modifiers.
func TestGrammarAdmissionSignatureModifierKeys(t *testing.T) {
	for _, source := range grammarSignatureModifierGaps {
		if got := grammarAdmissionForm(source); got != "admission:schema-signature-parameter-modifier" {
			t.Errorf("key=%q, want admission:schema-signature-parameter-modifier: %q", got, source)
		}
	}
	for source, want := range map[string]string{
		"schema S = { (async: Missing): Missing }":       "",
		"schema S = { (async, b: Missing): Missing }":    "",
		"schema S = { (async?: Missing): Missing }":      "",
		"schema S = { (async\n{p}: Missing): Missing }":  "",
		"type S = { (async {p}: Missing): Missing }":     "",
		"schema S { f(async {p}: Missing): Missing }":    "",
		"schema S = { (static: Missing): Missing }":      "admission:schema-signature-reserved-binding",
		"schema S = { (...static: Missing[]): Missing }": "admission:schema-signature-reserved-binding",
	} {
		if got := grammarAdmissionForm(source); got != want {
			t.Errorf("key=%q, want %q: %q", got, want, source)
		}
	}
}

func TestGrammarAdmissionSignatureModifierRegression(t *testing.T) {
	w := NewWorkspace(t)
	for _, source := range grammarSignatureModifierGaps {
		t.Run(source, func(t *testing.T) {
			if grammarAdmissionVerdict(t, w, source) {
				r, _ := w.Compile(context.Background(), Single(source))
				t.Fatalf("a rejected signature parameter is an admission gap: %v", r.Diagnostics)
			}
		})
	}
	// The type-alias twin keeps TS1090 and the named body EK1505; a line
	// break after async leaves a parameter named async and a syntax error.
	for _, source := range []string{
		"type S = { (async {p}: Missing): Missing }",
		"type S = { (async p: Missing): Missing }",
		"schema S { f(async {p}: Missing): Missing }",
		"schema S = { (async\n{p}: Missing): Missing }",
		"schema S = { (async: Missing): Missing }",
	} {
		t.Run(source, func(t *testing.T) {
			if grammarAdmissionVerdict(t, w, source) {
				t.Fatalf("control became an admission gap: %q", source)
			}
		})
	}
}
