package vibelangfuzz

import (
	"context"
	"strings"
	"testing"
)

const grammarUnhomedPatternReferenceQuote = "PatternMatchingMemberExpression[Yield, Await] :\n        `this`\n        MetaProperty\n        IdentifierReference[?Yield, ?Await]"

const grammarUnhomedPatternReservedReference = "function g(a = xs is [let first, static\n, 1]) {}"

func TestGrammarAdmissionUnhomedReferenceQuoted(t *testing.T) {
	if !strings.Contains(SpecText("../vips/tc39-pattern-matching/spec.emu"), grammarUnhomedPatternReferenceQuote) {
		t.Fatal("pinned pattern IdentifierReference production changed; review the admission key")
	}
}

func grammarUnhomedReservedReferences() []string {
	sources := []string{grammarUnhomedPatternReservedReference}
	for _, word := range []string{"static", "implements", "interface", "package", "private", "protected", "public", "yield"} {
		sources = append(sources,
			"function g(a = xs is [let first, "+word+"]) {}",
			"for (var i = 0; xs is [let first, "+word+"]; i++) {}",
		)
	}
	return sources
}

var grammarUnhomedReferenceControls = []string{
	// A bare let or const starts a binding pattern and is already rejected.
	"function g(a = xs is [let first, let]) {}",
	"function g(a = xs is [let first, const]) {}",
	"function g(a = xs is [let first, value]) {}",
	"function g(a = xs is {static: let first}) {}",
	"function g(a = xs is [let first, obj.static]) {}",
	"function g(a = xs is [let first, obj.implements]) {}",
	"function g(a = xs is [let first, 'static']) {}",
	"function g(a = xs is [let first, /* static */ value]) {}",
	"function g(a = xs is [let first, {static: 1}]) {}",
	"function g(a = xs is [let first, {[obj.static]: 1}]) {}",
	"if (xs is [let first, static]) {}",
	"const b = xs is [let first, static];",
	"const g = () => xs is [let first, static];",
	"const s = 'xs is [let first, static]';",
}

func TestGrammarAdmissionUnhomedReferenceKeys(t *testing.T) {
	for _, source := range grammarUnhomedReservedReferences() {
		if got := grammarAdmissionForm(source); got != "admission:unhomed-pattern-reserved-identifier" {
			t.Errorf("key=%q, want admission:unhomed-pattern-grammar: %q", got, source)
		}
	}
	for _, source := range grammarUnhomedReferenceControls {
		if got := grammarAdmissionForm(source); got == "admission:unhomed-pattern-reserved-identifier" {
			t.Errorf("control keyed as an unhomed reserved reference: %q", source)
		}
	}
}

func TestGrammarAdmissionUnhomedReferenceRegression(t *testing.T) {
	w := NewWorkspace(t)
	for _, source := range grammarUnhomedReservedReferences() {
		t.Run(source, func(t *testing.T) {
			if !grammarAdmissionVerdict(t, w, source) {
				r, _ := w.Compile(context.Background(), Single(source))
				t.Fatalf("witness no longer exposes an admission gap: %v", r.Diagnostics)
			}
			checkGrammarAdmission(t, w, grammarAdmissionMutationKey(source), source)
		})
	}
	for _, source := range grammarUnhomedReferenceControls {
		if grammarAdmissionVerdict(t, w, source) {
			t.Errorf("derived or syntax-rejected control became a gap: %q", source)
		}
	}
}
