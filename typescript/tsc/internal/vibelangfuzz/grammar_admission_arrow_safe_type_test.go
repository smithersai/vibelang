package vibelangfuzz

import (
	"context"
	"testing"
)

// A parenthesized type before "=>" in an arrow's return annotation.
// TypeScript reads "(" T ")" "=>" as a function type only when T could be a
// parameter: readonly and the other modifiers followed on the same line by a
// name, string, number, "[" or "{", then a lone name (contextual keywords
// such as number included), this, or an object or array binding pattern that
// parses without error. Every other T is a parenthesized type and the
// compiler admits the arrow. The subset writes that decision as a partition
// of Type: ParameterLikeType keeps the "=>" lookahead, ArrowSafeType has none.
var grammarArrowSafeSeeds = map[string]bool{
	"arrow-parenthesized-qualified-return":            true,
	"arrow-parenthesized-qualified-return-line-break": true,
	"arrow-parenthesized-generic-return":              true,
	"arrow-parenthesized-union-return":                true,
	"arrow-parenthesized-array-return":                true,
	"arrow-parenthesized-literal-return":              true,
	"arrow-parenthesized-tail-return":                 true,
	"arrow-parenthesized-optional-member-return":      true,
	"arrow-parenthesized-semicolon-member-return":     true,
	"arrow-parenthesized-optional-element-return":     true,
	"arrow-parenthesized-readonly-array-return":       true,
	"arrow-parenthesized-readonly-line-break-return":  true,
	"arrow-parenthesized-nested-return":               true,
	"arrow-parenthesized-keyof-return":                true,
	"arrow-parenthesized-reserved-shorthand-return":   true,
	"async-arrow-parenthesized-return":                true,
}

// grammarArrowSafeSyntaxRejected reports whether the compiler rejects the
// program as syntax, by a parse diagnostic or a syntax-class checker code.
func grammarArrowSafeSyntaxRejected(t *testing.T, w *Workspace, source string) bool {
	t.Helper()
	result, err := w.Compile(context.Background(), Single(source))
	if err != nil {
		t.Fatal(err)
	}
	if result.Program != nil && HasError(result.Program.GetSyntacticDiagnostics(context.Background(), nil)) {
		return true
	}
	for _, d := range result.Diagnostics {
		if grammarAdmissionSyntaxDiagnostic(d) {
			return true
		}
	}
	return false
}

func TestGrammarAdmissionArrowSafeTypes(t *testing.T) {
	w := NewWorkspace(t)
	seen := 0
	for _, seed := range grammarAdmissionSeeds {
		if !grammarArrowSafeSeeds[seed.key] {
			continue
		}
		seen++
		t.Run(seed.key, func(t *testing.T) {
			if grammarArrowSafeSyntaxRejected(t, w, seed.source) {
				t.Fatalf("admitted arrow rejected as syntax: %s", seed.source)
			}
			if grammarAdmissionVerdict(t, w, seed.source) {
				t.Fatal("parenthesized type before => still reported as an admission gap")
			}
			checkGrammarAdmission(t, w, "admission:"+seed.key, seed.source)
		})
	}
	if seen != len(grammarArrowSafeSeeds) {
		t.Fatalf("expected %d arrow seeds, found %d", len(grammarArrowSafeSeeds), seen)
	}
}

// Parameter-like contents start a function type, so the arrow then misses
// its "=>": stock tsc 5.9.3 reports TS1005, the compiler rejects the program
// as syntax, and the subset has no derivation.
func TestGrammarAdmissionArrowSafeTypeControls(t *testing.T) {
	w := NewWorkspace(t)
	lab, err := admissionLab()
	if err != nil {
		t.Fatal(err)
	}
	for _, content := range []string{
		"(x)", "(number)", "(this)", "(undefined)",
		"({ a: number })", "([number])",
		"(readonly T)", "(readonly [a, b])",
		"({ a: number, b: string })", "({ a })", "({ \"a\": number })", "({ a: { b: number } })",
		"([...number])", "([number, ])", "([[number]])", "([])", "({})",
	} {
		source := "const f = (): " + content + " => 1"
		t.Run(content, func(t *testing.T) {
			if !grammarArrowSafeSyntaxRejected(t, w, source) {
				t.Fatalf("compiler admits a function-type start before =>: %s", source)
			}
			if r := lab.read(lab.g, grammarLexSource(source), grammarParseMode{prose: true, names: true}); r.count != 0 {
				t.Errorf("parameter-like parenthesized content derives before =>: %q", source)
			}
		})
	}
}

// Away from "=>" the partition is exact: each parenthesized type derives
// once, through ParameterLikeType or ArrowSafeType.
func TestGrammarAdmissionArrowSafeTypePartition(t *testing.T) {
	lab, err := admissionLab()
	if err != nil {
		t.Fatal(err)
	}
	for _, source := range []string{
		"type T = (x)", "type T = (number)", "type T = (undefined)", "type T = (A.B)", "type T = (A<B>)",
		"type T = ({ a: number })", "type T = ({ a?: number })", "type T = ({ a: number; })", "type T = ({ a: A.B })",
		"type T = ({ let })", "type T = ({ class })", "type T = ({ a: this })",
		"type T = ([number])", "type T = ([number?])", "type T = ([...number])", "type T = ([...number[]])",
		"type T = ({ a: number } | B)", "type T = ((x) => y)", "type T = ((x))", "type T = (keyof K)",
		"type T = (readonly [a, b])", "type T = (readonly [a?])", "type T = (\"a\")",
	} {
		t.Run(source, func(t *testing.T) {
			if r := lab.read(lab.g, grammarLexSource(source), grammarParseMode{prose: true, names: true}); r.count != 1 {
				t.Errorf("want one derivation, got %d: %s", r.count, source)
			}
		})
	}
}
