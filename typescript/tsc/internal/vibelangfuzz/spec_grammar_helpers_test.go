package vibelangfuzz

import (
	"maps"
	"slices"
	"testing"
)

// TestSpecGrammarHelpers checks the grammar reader on a small document in the
// appendices' layout: productions in Appendix A's ```text blocks, before
// "### Productions" and under it, and headings and id attributes as anchors.
func TestSpecGrammarHelpers(t *testing.T) {
	doc := "# Appendices\n\n## Appendix A. Grammar\n\n### Contextual keywords\n\n<a id=\"datastart\"></a>\n\n" +
		"```text\nDataStart = \"data\" BindingIdentifier\n```\n\n```text\ndata Shape     an example, not a production\n```\n\n" +
		"### Productions\n\n#### TryExpression\n\n```text\nTryExpression = \"try\" UnaryExpression\n```\n\n" +
		"<a id=\"catchhead\"></a>\n\n```text\nCatchHead     = CatchExpression | BitwiseORExpression\n  | \"x\"\n```\n\n" +
		"## Appendix B. Diagnostics\n\n```text\nOther = not Appendix A\n```\n"
	got := slices.Sorted(maps.Keys(appendixProductions(doc)))
	if want := []string{"CatchHead", "DataStart", "TryExpression"}; !slices.Equal(got, want) {
		t.Errorf("appendixProductions = %v, want %v", got, want)
	}
	lines := grammarLines(doc)
	if lines[22] != `TryExpression = "try" UnaryExpression` {
		t.Errorf("grammarLines[22] = %q, want the TryExpression line", lines[22])
	}
	have := anchors(doc)
	for _, a := range []string{"tryexpression", "catchhead", "datastart", "appendix-a-grammar", "productions"} {
		if !have[a] {
			t.Errorf("anchors has no %q: %v", a, have)
		}
	}
	if production.MatchString(`  | "x"`) {
		t.Error("a continuation line matched as a production")
	}
}
