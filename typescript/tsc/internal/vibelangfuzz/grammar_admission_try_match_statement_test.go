package vibelangfuzz

import (
	"context"
	"strings"
	"testing"
)

// Chapter 2 makes a try outside effect code EK0501. The parser lowers a match
// written as a return operand or as a whole expression statement to
// statements (Parser.matchReturnStatement, Parser.matchStatement), and that
// lowering never reads the try flag on the match, so a plain function's
// `return try match (s) { ... }` compiles with no EK0501 and without the try.
func TestGrammarAdmissionTryMatchStatementQuoted(t *testing.T) {
	if !strings.Contains(SpecText("002-running.md"), grammarTryInHatchRuleQuote) {
		t.Fatal("Chapter 2's EK0501 row changed; review admission:try-match-statement")
	}
}

// grammarTryMatchStatement reports `try match (` as a return operand or at a
// statement start, the positions the parser lowers to statements. A
// TryExpression has no line-break restriction, so the match may start the
// next line.
func grammarTryMatchStatement(ts []grammarToken) bool {
	for i := 0; i+2 < len(ts); i++ {
		if ts[i].kind != 'w' || ts[i].text != "try" || ts[i+1].text != "match" || ts[i+2].text != "(" {
			continue
		}
		if i == 0 || ts[i].nl {
			return true
		}
		switch ts[i-1].text {
		case "return", ";", "{", "}":
			return true
		}
	}
	return false
}

const grammarTryMatchStatementWitness = "import { Effect } from \"effect\"\nexport function f(s: unknown) { return try match (s) { when 1: Effect.succeed(1); default: Effect.succeed(0); } }"

// The case-seeded campaign put try before a returned match of an error case.
const grammarTryMatchStatementCampaign = "error Plain { code : number ; label ( ) : number { return this . code } }\nschema error Encoded { get label ( ) : number { return this . code } ; code : number }\nexport function plainZero ( s : unknown ) { return try match ( s ) { when Plain ( ) : 1 ; default : 0 ; } }\nexport function plainTwo ( s : unknown ) { return match ( s ) { when Plain ( let a , let b ) : 1 ; default : 0 ; } }\nexport function schemaZero ( s : unknown ) { return match ( s ) { when Encoded ( ) : 1 ; default : 0 ; } }\nexport function schemaTwo ( s : unknown ) { return match ( s ) { when Encoded ( let a , let b ) : 1 ; default : 0 ; } }"

// A later campaign broke the line between try and the match statement.
const grammarTryMatchStatementLineBreak = "export function f(s: unknown) { try\nmatch (s) { when 1: 1; default: 0; } }"

var grammarTryMatchStatementGaps = []string{
	grammarTryMatchStatementWitness,
	grammarTryMatchStatementCampaign,
	"export function f(s: unknown) { return try match (s) { when 1: 1; default: 0; } }",
	"export function f(s: unknown) { try match (s) { when 1: 1; default: 0; } }",
	grammarTryMatchStatementLineBreak,
	"export function f(s: unknown) { if (s) return try match (s) { when 1: 1; default: 0; }; return 2 }",
}

func TestGrammarAdmissionTryMatchStatementKeys(t *testing.T) {
	for _, source := range grammarTryMatchStatementGaps {
		if got := grammarAdmissionForm(source); got != "admission:try-match-statement" {
			t.Errorf("key=%q, want admission:try-match-statement: %q", got, source)
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
	for _, source := range grammarTryMatchStatementGaps {
		t.Run(source, func(t *testing.T) {
			if !grammarAdmissionVerdict(t, w, source) {
				r, _ := w.Compile(context.Background(), Single(source))
				t.Fatalf("witness no longer exposes an admission gap: %v", r.Diagnostics)
			}
			checkGrammarAdmission(t, w, grammarAdmissionMutationKey(source), source)
		})
	}
	// The plain function returns the arm's Effect unrun.
	r, err := w.Compile(context.Background(), Single(grammarTryMatchStatementWitness))
	if err != nil {
		t.Fatal(err)
	}
	if len(r.Diagnostics) != 0 || !strings.Contains(r.Outputs["out/main.js"], "return Effect.succeed(1);") {
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
