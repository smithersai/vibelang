package parser_test

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
)

// theoremForms lists what the parser flagged in file: "theorem t" for a
// theorem, "spec f" for a spec function, "proof" for a proof block and
// "call name" for a proof statement.
func theoremForms(file *ast.SourceFile) []string {
	const theorem = ast.NodeFlagsVibeLangSpec | ast.NodeFlagsVibeLangProof
	var forms []string
	var visit func(n *ast.Node) bool
	visit = func(n *ast.Node) bool {
		switch {
		case n.Kind == ast.KindFunctionDeclaration && n.Flags&theorem == theorem:
			forms = append(forms, "theorem "+n.Name().Text())
		case n.Kind == ast.KindFunctionDeclaration && n.Flags&ast.NodeFlagsVibeLangSpec != 0:
			forms = append(forms, "spec "+n.Name().Text())
		case n.Kind == ast.KindBlock && n.Flags&ast.NodeFlagsVibeLangProof != 0:
			forms = append(forms, "proof")
		case n.Kind == ast.KindCallExpression && n.Flags&ast.NodeFlagsVibeLangProof != 0:
			forms = append(forms, "call "+n.Expression().Text())
		}
		return n.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
	return forms
}

// VIP-43 (Appendix F "Syntax"): theorem is a keyword only before a binding
// identifier other than as, satisfies or is, then ( or <, on the same line.
// A theorem body is a proof context: its proof statements are calls by
// their plain names, in the body and in its if statements and blocks.
// Everything else keeps its TypeScript reading.
func TestTheoremFormsAreContextual(t *testing.T) {
	for _, tc := range []struct{ source, want string }{
		{"theorem t(x: number) { assume(x > 0); assert(x > 0) }", "theorem t call assume call assert"},
		{"theorem t<T>(xs: readonly T[]) { if (xs) { assert(true) } else assert(false) }", "theorem t call assert call assert"},
		{"theorem t(x: number) { const y = x\n { ensures((r) => r); invariant(y); decreases(y) } }", "theorem t call ensures call invariant call decreases"},
		{"export theorem t() { }", "theorem t"},
		{"export default theorem t() { }", "theorem t"},
		{"export default theorem", ""},
		{"theorem t(x: number): void { assert(true) }", "theorem t call assert"},
		{"theorem t(x: number)\nconst one = 1", "theorem t"},
		{"theorem\nt(x)", ""},
		{"theorem t\n(x)", "theorem t"},
		{"theorem as T", ""},
		{"theorem satisfies T", ""},
		{"theorem is(x)", ""},
		{"theorem(1)", ""},
		{"theorem t", ""},
		{"theorem.t(x)", ""},
		{"const theorem = 1; theorem", ""},
		{"theorem theorem(theorem: number) { assert(theorem > 0) }", "theorem theorem call assert"},
		{"theorem t() { proof { assert(true) } }", "theorem t proof call assert"},
		{"theorem t() { (assert)(true); x.assert(true); assert<boolean>(true); assert?.(true); f(assert(true)) }", "theorem t"},
		{"theorem t() { const g = () => { assert(true) } }", "theorem t"},
		{"function f() { theorem t() { assert(true) } }", "theorem t call assert"},
		{"theorem t() { assert(true) }\nassert(false)", "theorem t call assert"},
		{"spec function f() { }\ntheorem t() { assert(f()) }", "spec f theorem t call assert"},
	} {
		t.Run(tc.source, func(t *testing.T) {
			file := parseProofSource("/main.vibe", tc.source)
			if got := strings.Join(theoremForms(file), " "); got != tc.want {
				t.Fatalf("got %q, want %q", got, tc.want)
			}
			if ts := parseProofSource("/main.ts", tc.source); len(theoremForms(ts)) != 0 {
				t.Fatalf("a .ts file reads %v", theoremForms(ts))
			}
		})
	}
}

// A theorem parses as a function declaration without the function keyword:
// its name, type parameters, parameters, return type and body are the
// function's, so the checker and the tools read it as one.
func TestTheoremIsAFunctionDeclaration(t *testing.T) {
	source := "/** Doubling is even. */\ntheorem doubled<T>(n: number, xs: readonly T[]): void {\n  assert(n + n === 2 * n)\n}\n"
	file := parseProofSource("/main.vibe", source)
	if len(file.Diagnostics()) != 0 {
		t.Fatalf("diagnostics: %v", file.Diagnostics())
	}
	fn := file.Statements.Nodes[0]
	if fn.Kind != ast.KindFunctionDeclaration {
		t.Fatalf("got %v, want a function declaration", fn.Kind)
	}
	decl := fn.AsFunctionDeclaration()
	if fn.Name().Text() != "doubled" || len(decl.TypeParameters.Nodes) != 1 || len(decl.Parameters.Nodes) != 2 || decl.Type == nil || decl.Body == nil || decl.AsteriskToken != nil {
		t.Fatalf("the theorem's parts differ from the source's")
	}
	if got := source[fn.Pos():fn.End()]; !strings.HasSuffix(got, "}") || !strings.Contains(got, "theorem doubled") {
		t.Fatalf("the theorem spans %q", got)
	}
}

// An escaped spelling of the keyword is TypeScript's TS1260, as for effect.
func TestTheoremKeywordRejectsEscapes(t *testing.T) {
	file := parseProofSource("/main.vibe", "the\\u006frem t() { assert(true) }")
	if got := strings.Join(theoremForms(file), " "); got != "theorem t call assert" {
		t.Fatalf("got %q", got)
	}
	found := false
	for _, d := range file.Diagnostics() {
		found = found || d.Code() == 1260
	}
	if !found {
		t.Fatalf("no TS1260 among %v", file.Diagnostics())
	}
}
