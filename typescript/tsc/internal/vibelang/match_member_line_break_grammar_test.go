package vibelang

import "testing"

// VIP-7's pinned PatternMatchingMemberExpression has no LineTerminator
// restriction before computed access; its brackets require an Expression.
func TestMatchMemberLineBreakGrammar(t *testing.T) {
	for _, row := range []struct {
		name, pattern string
		rejected      bool
	}{
		{"empty", "C\n[]", true},
		{"empty-crlf", "C\r\n[]", true},
		{"commented-empty", "C /*\n*/ []", true},
		{"elision", "C\n[,]", true},
		{"spread", "C\n[...items]", true},
		{"trailing-comma", "C\n[key,]", true},
		{"nested-trailing", "C\n[[],]", true},
		{"logical-and", "C and C\n[]", true},
		{"logical-or", "C or C\n[]", true},
		{"negated", "not C\n[]", true},
		{"relational", "> C\n[]", true},
		{"computed", "C\n[key]", false},
		{"qualified", "ns.C\n[key]", false},
		{"chained", "C[key]\n[key]", false},
		{"commented", "C /*\n*/ [key]", false},
		{"comma-expression", "C\n[key,key]", false},
		{"explicit-semicolon", "C;\n[]", false},
		{"array-pattern", "[let a]\n[]", false},
		{"extractor", "C()\n[]", false},
	} {
		t.Run(row.name, func(t *testing.T) {
			p, f, _, _ := editorProgram(t, "const value: unknown = 1;\nconst result = value is "+row.pattern+";\nexport {}")
			got := p.GetSyntacticDiagnostics(t.Context(), f)
			if (len(got) > 0) != row.rejected {
				t.Fatalf("syntax diagnostics=%v want rejected=%v: %q", got, row.rejected, row.pattern)
			}
		})
	}
}
