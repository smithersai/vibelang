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

// TestAppendixBRows checks the Appendix B reader on a table in round 13's
// layout, a code in backticks and a rule whose text holds a pipe, and that
// the code oracle takes every code the real Appendix B assigns.
func TestAppendixBRows(t *testing.T) {
	doc := "## Appendix B. Diagnostics\n\n| Code | Rule | VIP | Chapter |\n| --- | --- | --- | --- |\n" +
		"| `EK0101` | `effect f() { }` outside a class | 1 | [Functions](001-functions.md#effect-functions) |\n" +
		"| EK0107 | `a \\| b` in a type | 1, 4 | [Functions](001-functions.md#direct-eval) |\n\n## Appendix C\n\n| `EK9999` | not B | 9 | x |\n"
	rows, _ := appendixBRows(doc)
	if want := map[string]string{"0101": "1", "0107": "1, 4"}; !maps.Equal(rows, want) {
		t.Errorf("appendixBRows = %v, want %v", rows, want)
	}
	codes := AppendixBCodes()
	if len(codes) == 0 {
		t.Fatal("Appendix B assigns no code")
	}
	for _, code := range codes {
		if !SpecHasCode(code) {
			t.Errorf("Appendix B assigns EK%04d, but SpecHasCode does not take it", code)
		}
	}
}
