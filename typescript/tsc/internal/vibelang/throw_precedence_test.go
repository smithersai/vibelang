package vibelang

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// S10-12: exercise the native checker, not just the parser shape. A throw's
// parentheses belong either to its operand (still refused) or to the whole
// throw expression (explicit and allowed); right-hand forms and statements
// must retain D186's existing behavior.
func TestThrowExpressionPrecedenceEK1010(t *testing.T) {
	expressions := []string{}
	for _, op := range []string{"+", "-", "*", "/", "%", "**", "<<", ">>", ">>>", "<", "<=", ">", ">=", "==", "!=", "===", "!==", "&", "|", "^", "&&", "||", "??", "=", "+=", "**=", "??=", "&&=", "||="} {
		expressions = append(expressions, "throw x "+op+" x")
	}
	expressions = append(expressions, "throw x ? 1 : 2", "throw x |> %", "throw x |> x(1)(%)")
	type expected struct {
		start, length  int
		operand, token string
	}
	var want []expected
	var source strings.Builder
	for i, expr := range expressions {
		prefix := fmt.Sprintf("export function bad%d(x: any) { return ", i)
		want = append(want, expected{source.Len() + len(prefix), len("throw x"), "x", throwFollowingToken(expr)})
		source.WriteString(prefix + expr + " }\n")
	}
	for i, tc := range []struct{ expression, span, operand string }{
		{"throw (x) + 1", "throw (x)", "(x)"},
		{"throw /* trivia */ x === 1", "throw /* trivia */ x", "x"},
		{"throw x.code === \"unknown\" ? 1 : 2", "throw x.code", "x.code"},
	} {
		prefix := fmt.Sprintf("// @ts-ignore\nexport function trivia%d(x: any) { return ", i)
		want = append(want, expected{source.Len() + len(prefix), len(tc.span), tc.operand, throwFollowingToken(tc.expression)})
		source.WriteString(prefix + tc.expression + " }\n")
	}
	// A throw that ends an operator's left operand or a conditional's
	// condition throws only its operand too: x ?? throw x ? 1 : 2 is
	// (x ?? throw x) ? 1 : 2.
	for i, expr := range trailingThrowExpressions {
		prefix := fmt.Sprintf("export function trailing%d(x: any) { return ", i)
		want = append(want, expected{source.Len() + len(prefix) + strings.Index(expr, "throw x"), len("throw x"), "x", throwFollowingToken(expr)})
		source.WriteString(prefix + expr + " }\n")
	}
	hatchPrefix := "export function hatch() { return sync((x: any) => "
	want = append(want, expected{source.Len() + len(hatchPrefix), len("throw x"), "x", "??"})
	source.WriteString(hatchPrefix + "throw x ?? 1, 0) }\n")
	for i, expr := range []string{
		"throw x in x", "throw x instanceof x", "throw x as any", "throw x satisfies any",
		"!throw x", "throw throw x", "x ?? throw x as any", "x || throw x satisfies any",
		"x ?? throw x", "x || throw x", "x && throw x", "x ? 1 : throw x", "x ? throw x : 1",
		"((x: any) => x ?? throw x)(x)", "throw (x ? 1 : 2)", "throw (x === 1)",
		"throw (x ?? 1)", "throw (x as any)", "throw (x satisfies any)", "throw (x |> x(1)(%))", "(throw x) |> x(1)(%)",
		"(throw x) ?? 1", "(throw x) ? 1 : 2", "(throw x) as any", "(throw x) satisfies any",
		"((throw x), 1)", "(() => { throw x })() ?? 1", "do { throw x } ?? 1",
		"(x ?? throw x) ? 1 : 2", "x ?? (throw x) ? 1 : 2", "((x ?? throw x), 1)", "x ? 1 : x ?? throw x", "[x ?? (throw x), 1]",
	} {
		fmt.Fprintf(&source, "export function good%d(x: any) { return %s }\n", i, expr)
	}
	source.WriteString("export function statement(x: any) { throw x ? 1 : 2; }\n")
	source.WriteString("export function caught(x: any) { return statement(x) catch (e) => throw (x ? 1 : 2) }\n")
	p, file, _, _ := editorProgram(t, source.String())
	count := 0
	for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), file), p.GetSemanticDiagnostics(t.Context(), file)...) {
		if d.Code() != EK1010.Code {
			continue
		}
		if count >= len(want) {
			t.Fatalf("unexpected EK1010: %s", d.String())
		}
		w := want[count]
		message := "A throw expression can't be followed by " + w.token + ": write throw (…) to throw the whole expression, or (throw " + w.operand + ") to throw only " + w.operand + "."
		if d.Pos() != w.start || d.Len() != w.length || d.String() != message || d.Category() != diagnostics.CategoryError {
			t.Errorf("diagnostic %d: got %s at %d+%d; want %s at %d+%d", count, d.String(), d.Pos(), d.Len(), message, w.start, w.length)
		}
		count++
	}
	if count != len(want) {
		t.Fatalf("got %d EK1010 diagnostics, want %d", count, len(want))
	}
}

// trailingThrowExpressions end an operator's left operand, or a conditional's
// condition, with an unparenthesized throw; each throws only x.
var trailingThrowExpressions = []string{
	"x ?? throw x ? 1 : 2", "x || throw x || 1", "x && throw x ? 1 : 2",
	"x ?? throw x |> %", "x ?? throw x |> x(1)(%)", "x ? 1 : x ?? throw x ? 1 : 2",
}

// The expected token follows the operand written in these table rows.
func throwFollowingToken(expression string) string {
	at := strings.Index(expression, "throw ")
	tail := strings.TrimSpace(expression[at+len("throw "):])
	if strings.HasPrefix(tail, "/* trivia */") {
		tail = strings.TrimSpace(strings.TrimPrefix(tail, "/* trivia */"))
	}
	token := strings.Fields(tail)[1]
	if token == "|>" {
		return "|"
	}
	return token
}

// Native ThrowStatement's newline restriction is a checker grammar error.
// Expression-position throw has no such restriction in the proposal.
func TestThrowStatementNewlineNativeDiagnostic(t *testing.T) {
	source := "export function f(e: unknown) { throw\n e; }"
	p, file, _, _ := editorProgram(t, source)
	for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), file), p.GetSemanticDiagnostics(t.Context(), file)...) {
		if d.Code() == 1142 && d.Source() != "EK" {
			return
		}
	}
	t.Fatal("a newline after a throw statement must remain native TS1142")
}
