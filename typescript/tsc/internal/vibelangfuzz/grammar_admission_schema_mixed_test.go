package vibelangfuzz

import (
	"context"
	"strings"
	"testing"
)

// VIP-15 and Appendix A's Field production admit only readonly before a
// property. EK2109 is a schema type/value error, not a syntax rejection;
// TestGrammarAdmissionSchemaAsyncQuoted and SchemaTypeQuoted pin those rules.
func TestGrammarAdmissionSchemaMixedModifierKeys(t *testing.T) {
	// Cross modifier order, duplicate async, readonly/static, field spellings
	// and declaration/alias bodies. The key remains the existing async
	// family regardless of which modifier hides behind another one; a field
	// whose effect modifier the compiler rejects is no mismatch and needs none.
	for _, prefix := range []string{
		"async effect", "effect async", "async async effect",
		"async effect async", "effect async async",
		"readonly async effect", "async readonly effect",
		"effect readonly async", "static async effect",
		"async static effect", "effect static async",
		"static readonly async effect", "readonly effect static async",
	} {
		for _, field := range []string{"id: Missing", "id?: Missing", "'id': Missing", "[key]: Missing", "effect: Missing"} {
			for _, declaration := range []string{"schema S { ", "schema S = { ", "schema S = ({ "} {
				close := " }"
				if strings.Contains(declaration, "({") {
					close = " });"
				}
				source := declaration + prefix + " " + field + close
				if key := grammarAdmissionForm(source); key != "admission:schema-async-field" {
					t.Errorf("mixed field lost its existing async family: key=%q, source=%s", key, source)
				}
			}
		}
	}
	for _, source := range []string{
		"schema S { async effect() {} }",
		"schema S { async effect m() {} }",
		"schema S { effect async m() {} }",
		"schema S { async effect id() {} }",
		"schema S { async effect\nid: Missing }",
		"schema\nS { async effect id: Missing }",
		"schema S { readonly effect: Missing }",
		"schema S { effect: Missing }",
		"schema error S { async effect id: Missing }",
		"class S { async effect id: Missing }",
		"interface S { async effect id: Missing }",
		"const o = { schema: { async: 1, effect: 2 } };",
	} {
		if key := grammarAdmissionForm(source); key == "admission:schema-async-field" {
			t.Errorf("non-field/native boundary gained the async exemption: %s", source)
		}
	}
}

func TestGrammarAdmissionSchemaMixedModifierRegression(t *testing.T) {
	w := NewWorkspace(t)
	for _, source := range []string{
		"schema S { async async effect id : Missing }",
		"schema S { async effect id: Missing }",
		"schema S { readonly async effect id?: Missing }",
		"schema S { static async effect id: Missing }",
		"schema S { async effect 'id': Missing }",
		"schema S { async effect [key]: Missing }",
		"schema S = { async effect id: Missing };",
	} {
		t.Run(source, func(t *testing.T) {
			result, err := w.Compile(context.Background(), Single(source))
			if err != nil {
				t.Fatal(err)
			}
			seen := false
			for _, d := range result.Diagnostics {
				if IsEK(d) && d.Code() == 2109 {
					seen = true
					if grammarAdmissionSyntaxDiagnostic(d) {
						t.Fatal("EK2109 cannot excuse an unadmitted field modifier")
					}
				}
			}
			if !seen {
				t.Fatalf("control did not exercise EK2109: %v", result.Diagnostics)
			}
			// The effect modifier on the field is EK0108, a syntax rejection
			// beside EK2109: the mixed prefix is no admission gap.
			if grammarAdmissionVerdict(t, w, source) {
				t.Fatalf("a field with an effect modifier is an admission gap: %v", result.Diagnostics)
			}
			checkGrammarAdmission(t, w, "mixed-modifier-control", source)
		})
	}
	for _, source := range []string{
		"schema S { async: Missing; effect: Missing }",
		"schema S { readonly effect?: Missing }",
		"schema S { async effect id: string }",
		"schema S { effect async id: Missing }",
		"schema error S { async effect id: Missing }",
		"interface S { async effect id: Missing }",
		"class S { async effect() {} }",
	} {
		t.Run(source, func(t *testing.T) {
			if grammarAdmissionVerdict(t, w, source) {
				t.Fatal("native/typed-field control became an undefined syntax exemption")
			}
		})
	}
	// The saved minimizer input must still reconstruct its exact witness.
	_, source := grammarAdmissionInput([]byte("key:schema-async-duplicate-modifier\n010097y"))
	if source != "schema S { async async effect id : Missing }" {
		t.Fatalf("saved mutation changed meaning: %s", source)
	}
	checkGrammarAdmission(t, w, "mixed-modifier-mutation", source)
}
