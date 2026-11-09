package vibelangfuzz

import (
	"context"
	"strings"
	"testing"
)

// Appendix A rejects an interface or type-literal member written with the
// effect modifier with EK0108. A schema object-type alias maps an effect
// method signature to an unsupported member (EK2109) and reports EK0108 for
// the modifier beside it. A method named effect and an effect modifier ended
// by a line break are separate members.
func grammarSchemaEffectMethod(ts []grammarToken) bool {
	return grammarSchemaModifiedMethod(ts, "effect")
}

func TestGrammarAdmissionSchemaEffectMethodKeys(t *testing.T) {
	if !strings.Contains(SpecText(grammarAppendix), grammarEffectTypeMemberQuote) {
		t.Fatalf("the Appendix A EffectModifier rejection changed: %s", grammarEffectTypeMemberQuote)
	}
	for source, want := range map[string]string{
		"schema S = { effect id() }":                "admission:schema-effect-method",
		"schema S = { effect effect() }":            "admission:schema-effect-method",
		"schema S = { effect id(): Missing }":       "admission:schema-effect-method",
		"schema S = { effect id<T>(): T }":          "admission:schema-effect-method",
		"schema S = { effect id?() }":               "admission:schema-effect-method",
		"schema S = { effect [k]() }":               "admission:schema-effect-method",
		"schema S = { async\neffect id() }":         "admission:schema-effect-method",
		"schema S =\n{ async\neffect effect (\n) }": "admission:schema-effect-method",
		"schema S = { a: Missing; effect id() }":    "admission:schema-effect-method",
		"schema S = { async; effect id() }":         "admission:schema-effect-method",
		"schema S = { effect() }":                   "",
		"schema S = { effect\nid() }":               "",
		"schema S { effect id() }":                  "",
		"schema error E { effect id() }":            "",
		"type S = { effect id() }":                  "",
		"interface I { effect id() }":               "",
		"schema S = { effect id: Missing }":         "",
		"schema S = { readonly effect fork() }":     "admission:schema-readonly-method",
		"schema S = { static effect id() }":         "admission:schema-static-method",
		"schema S = { async effect id() }":          "admission:schema-async-method",
	} {
		if got := grammarAdmissionForm(source); got != want {
			t.Errorf("key=%q, want %q: %q", got, want, source)
		}
	}
}

func TestGrammarAdmissionSchemaEffectMethodRegression(t *testing.T) {
	w := NewWorkspace(t)
	for _, source := range []string{
		"schema S = { effect id() }",
		"schema S = { effect id?() }",
		"schema S = { a: string; effect id() }",
		"schema S =\n{ async\neffect effect (\n) }",
	} {
		t.Run(source, func(t *testing.T) {
			// The effect modifier is EK0108 beside the EK2109 of the
			// unsupported member: no admission gap.
			if grammarAdmissionVerdict(t, w, source) {
				r, _ := w.Compile(context.Background(), Single(source))
				t.Fatalf("a rejected effect method is an admission gap: %v", r.Diagnostics)
			}
		})
	}
	// The same members outside a schema alias keep their EK0108 or EK1505
	// syntax rejection; a line break ends the modifier.
	for _, source := range []string{
		"type S = { effect id() }",
		"interface I { effect id() }",
		"type S = { async\neffect effect (\n) }",
		"schema S { effect id() }",
		"schema S = { effect\nid() }",
	} {
		t.Run(source, func(t *testing.T) {
			if grammarAdmissionVerdict(t, w, source) {
				t.Fatalf("control became an admission gap: %q", source)
			}
		})
	}
}
