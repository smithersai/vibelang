package vibelangfuzz

import (
	"context"
	"strings"
	"testing"
)

// Chapter 2 makes a try outside effect code EK0501, including a match
// written as a returned operand, a complete statement or across a line break.
func TestGrammarAdmissionTryMatchStatementQuoted(t *testing.T) {
	if !strings.Contains(SpecText("002-running.md"), grammarTryInHatchRuleQuote) {
		t.Fatal("Chapter 2's EK0501 row changed; review admission:try-match-statement")
	}
}

const grammarTryMatchStatementWitness = "import { Effect } from \"effect\"\nexport function f(s: unknown) { return try match (s) { when 1: Effect.succeed(1); default: Effect.succeed(0); } }"

// The case-seeded campaign put try before a returned match of an error case.
const grammarTryMatchStatementCampaign = "error Plain { code : number ; label ( ) : number { return this . code } }\nschema error Encoded { get label ( ) : number { return this . code } ; code : number }\nexport function plainZero ( s : unknown ) { return try match ( s ) { when Plain ( ) : 1 ; default : 0 ; } }\nexport function plainTwo ( s : unknown ) { return match ( s ) { when Plain ( let a , let b ) : 1 ; default : 0 ; } }\nexport function schemaZero ( s : unknown ) { return match ( s ) { when Encoded ( ) : 1 ; default : 0 ; } }\nexport function schemaTwo ( s : unknown ) { return match ( s ) { when Encoded ( let a , let b ) : 1 ; default : 0 ; } }"

// A later campaign broke the line between try and the match statement.
const grammarTryMatchStatementLineBreak = "export function f(s: unknown) { try\nmatch (s) { when 1: 1; default: 0; } }"

var grammarTryMatchStatementCases = []string{
	grammarTryMatchStatementWitness,
	grammarTryMatchStatementCampaign,
	"export function f(s: unknown) { return try match (s) { when 1: 1; default: 0; } }",
	"export function f(s: unknown) { try match (s) { when 1: 1; default: 0; } }",
	grammarTryMatchStatementLineBreak,
	"export function f(s: unknown) { if (s) return try match (s) { when 1: 1; default: 0; }; return 2 }",
}

func TestGrammarAdmissionTryMatchStatementKeys(t *testing.T) {
	for _, source := range grammarTryMatchStatementCases {
		if got := grammarAdmissionForm(source); got == "admission:try-match-statement" {
			t.Errorf("fixed source retains a pending-family key: %q", source)
		}
	}
	for _, source := range []string{
		"export function f(s: unknown) { const x = try match (s) { when 1: 1; default: 0; }; return x }",
		"export function f(s: unknown) { return try (match (s) { when 1: 1; default: 0; }) }",
		"export const g = (s: unknown) => try match (s) { when 1: 1; default: 0; }",
		"export function f(s: unknown) { return match (s) { when 1: 1; default: 0; } }",
	} {
		if got := grammarAdmissionForm(source); got == "admission:try-match-statement" {
			t.Errorf("control keyed as a try before a statement match: %q", source)
		}
	}
}

func TestGrammarAdmissionTryMatchStatementRegression(t *testing.T) {
	w := NewWorkspace(t)
	for _, source := range grammarTryMatchStatementCases {
		t.Run(source, func(t *testing.T) {
			r, err := w.Compile(context.Background(), Single(source))
			if err != nil {
				t.Fatal(err)
			}
			count := 0
			for _, d := range r.Diagnostics {
				if d.Source() == "EK" && d.Code() == 501 {
					count++
					if !grammarAdmissionSyntaxDiagnostic(d) {
						t.Error("EK0501 must count as syntax rejection")
					}
				}
			}
			if count != 1 {
				t.Fatalf("want exactly one EK0501 on the retained witness, got %d: %v", count, r.Diagnostics)
			}
			checkGrammarAdmission(t, w, grammarAdmissionMutationKey(source), source)
		})
	}
	// Rejected source still emits the arm's Effect unrun when emission is enabled.
	r, err := w.Compile(context.Background(), Single(grammarTryMatchStatementWitness))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(r.Outputs["out/main.js"], "return Effect.succeed(1);") {
		t.Errorf("witness diagnostics or emit changed: %v\n%s", r.Diagnostics, r.Outputs["out/main.js"])
	}
	for _, source := range []string{
		"export function f(s: unknown) { const x = try match (s) { when 1: 1; default: 0; }; return x }",
		"export function f(s: unknown) { return try (match (s) { when 1: 1; default: 0; }) }",
		"export const g = (s: unknown) => try match (s) { when 1: 1; default: 0; }",
		"export effect function f(s: unknown) { return try match (s) { when 1: 1; default: 0; } }",
	} {
		if grammarAdmissionVerdict(t, w, source) {
			t.Errorf("derived or syntax-rejected control became a gap: %q", source)
		}
	}
}
