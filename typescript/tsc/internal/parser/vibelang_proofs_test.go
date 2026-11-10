package parser_test

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

func parseProofSource(fileName string, source string) *ast.SourceFile {
	return parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: tspath.RootedFilePath(fileName), PathKey: tspath.PathKey(fileName)}, source, core.ScriptKindTS)
}

// proofForms lists what the parser flagged in file: "spec f" for a spec
// function, "proof" for a proof block, "call name" for a proof statement.
func proofForms(file *ast.SourceFile) []string {
	var forms []string
	var visit func(n *ast.Node) bool
	visit = func(n *ast.Node) bool {
		switch {
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

// VIP-43 (Appendix F "Syntax"): spec and proof are keywords only before the
// tokens listed, on the same line; proof statements are calls by their plain
// names in a proof block. Everything else keeps its TypeScript reading.
func TestProofFormsAreContextual(t *testing.T) {
	for _, tc := range []struct{ source, want string }{
		{"spec function f(): number { return 1 }", "spec f"},
		{"spec async function f() { }", "spec f"},
		{"spec effect function f() { }", "spec f"},
		{"export spec function f() { }", "spec f"},
		{"export default spec function f() { }", "spec f"},
		{"export default spec", ""},
		{"spec function* f() { }", "spec f"},
		{"spec\nfunction f() { }", ""},
		{"spec(1)", ""},
		{"const spec = 1; spec", ""},
		{"function f() { proof { assume(true); assert(true) } }", "proof call assume call assert"},
		{"function f() { proof {\n if (x) { invariant(x) } else decreases(1)\n const k = 1\n} }", "proof call invariant call decreases"},
		{"function f() { proof\n{ assume(true) } }", ""},
		{"function f() { proof: { assume(true) } }", ""},
		{"function f() { proof { (assume)(true); x.assert(true); assert<boolean>(true); assert?.(true); f(assume(true)) } }", "proof"},
		{"function f() { proof { const g = () => { assert(true) } } }", "proof"},
		{"function f() { assume(true); assert(false) }", ""},
		{"function f() { proof { proof { ensures((r) => r) } } }", "proof proof call ensures"},
	} {
		t.Run(tc.source, func(t *testing.T) {
			file := parseProofSource("/main.vibe", tc.source)
			if got := strings.Join(proofForms(file), " "); got != tc.want {
				t.Fatalf("got %q, want %q", got, tc.want)
			}
			if ts := parseProofSource("/main.ts", tc.source); len(proofForms(ts)) != 0 {
				t.Fatalf("a .ts file reads %v", proofForms(ts))
			}
		})
	}
}

// A keyword is written without Unicode escapes: an escaped spec or proof
// before its form is TS1260, as for effect. An escaped proof statement name
// is an ordinary call.
func TestProofKeywordEscapes(t *testing.T) {
	for _, form := range []struct{ word, before, after string }{
		{"spec", "", " function f() { }"},
		{"proof", "function f() { ", " { assert(true) } }"},
	} {
		for i := range len(form.word) {
			escaped := form.word[:i] + fmt.Sprintf("\\u%04x", form.word[i]) + form.word[i+1:]
			source := form.before + escaped + form.after
			t.Run(source, func(t *testing.T) {
				file := parseProofSource("/main.vibe", source)
				ds := file.Diagnostics()
				start := strings.Index(source, escaped)
				if len(ds) != 1 || ds[0].Code() != 1260 || ds[0].Pos() != start {
					t.Fatalf("want TS1260 at %d, got %v", start, ds)
				}
			})
		}
	}
	escaped := "a" + fmt.Sprintf("\\u%04x", "s"[0]) + "sume"
	file := parseProofSource("/main.vibe", "function f() { proof { "+escaped+"(true) } }")
	if got := strings.Join(proofForms(file), " "); got != "proof" {
		t.Fatalf("an escaped assume is an ordinary call, got %q", got)
	}
}
