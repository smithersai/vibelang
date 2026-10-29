package vibelangfuzz

import (
	"maps"
	"slices"
	"testing"
)

// TestSpecGrammarHelpers checks the grammar reader on a small document in the
// appendices' layout: productions in ```text blocks under Appendix A's
// "### Productions", headings and id attributes as anchors.
func TestSpecGrammarHelpers(t *testing.T) {
	doc := "# Appendices\n\n## Appendix A. Grammar\n\n```text\nNotAProduction = outside the productions\n```\n\n" +
		"### Productions\n\n#### TryExpression\n\n```text\nTryExpression = \"try\" UnaryExpression\n```\n\n" +
		"<a id=\"catchhead\"></a>\n\n```text\nCatchHead     = CatchExpression | BitwiseORExpression\n  | \"x\"\n```\n\n" +
		"## Appendix B. Diagnostics\n\n```text\nOther = not Appendix A\n```\n"
	got := slices.Sorted(maps.Keys(appendixProductions(doc)))
	if want := []string{"CatchHead", "TryExpression"}; !slices.Equal(got, want) {
		t.Errorf("appendixProductions = %v, want %v", got, want)
	}
	lines := grammarLines(doc)
	if lines[14] != `TryExpression = "try" UnaryExpression` {
		t.Errorf("grammarLines[14] = %q, want the TryExpression line", lines[15])
	}
	have := anchors(doc)
	for _, a := range []string{"tryexpression", "catchhead", "appendix-a-grammar", "productions"} {
		if !have[a] {
			t.Errorf("anchors has no %q: %v", a, have)
		}
	}
	if production.MatchString(`  | "x"`) {
		t.Error("a continuation line matched as a production")
	}
}
