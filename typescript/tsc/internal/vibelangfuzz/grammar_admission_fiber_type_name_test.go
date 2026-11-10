package vibelangfuzz

import (
	"context"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

// Appendix A reserves the two words in every binding position of effect
// code. A type alias, an interface, an enum and a type parameter each bind
// their name.
const grammarFiberTypeNameQuote = "An `IdentifierReference`, `BindingIdentifier` or `LabelIdentifier` can't be `fork` or `join`"

func TestGrammarAdmissionFiberTypeNameQuoted(t *testing.T) {
	if !strings.Contains(SpecText(grammarAppendix), grammarFiberTypeNameQuote) {
		t.Fatal("Appendix A's fork and join reservation changed; review the admission key")
	}
}

// grammarFiberTypeName identifies type alias, interface, enum and declaration
// type-parameter names reserved by the source Effect context. A callable's
// generic head inherits that context; its value parameters and body use the
// callable's own context. Member names, tuple labels and names within type
// syntax retain their separate contexts.
func grammarFiberTypeName(source string) bool {
	if !strings.Contains(source, "fork") && !strings.Contains(source, "join") {
		return false
	}
	file, _ := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{
		FileName: "/fuzz/main.vibe", PathKey: "/fuzz/main.vibe",
	}, source)
	reserved := func(name *ast.Node) bool {
		return name != nil && ast.IsIdentifier(name) && (name.Text() == "fork" || name.Text() == "join")
	}
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		if n == nil {
			return false
		}
		switch n.Kind {
		case ast.KindTypeAliasDeclaration, ast.KindInterfaceDeclaration, ast.KindEnumDeclaration, ast.KindTypeParameter:
			// TypeScript clears its Await parameter while parsing a type.
			// Inferred names, mapped keys and callable type parameters inside
			// a type keep that boundary; declaration type parameters do not.
			if n.Kind == ast.KindTypeParameter {
				for parent := n.Parent; parent != nil; parent = parent.Parent {
					if ast.IsTypeNode(parent) {
						return false
					}
					if ast.IsDeclarationStatement(parent) || ast.IsFunctionLike(parent) && parent.Body() != nil {
						break
					}
				}
			}
			if name := n.Name(); reserved(name) && grammarAdmissionEffectAt(file, name.End()-1) {
				return true
			}
		}

		return n.ForEachChild(visit)
	}
	return visit(file.AsNode())
}

const grammarFiberTypeNameWitness = "effect function f() { type fork = 1 }"

var grammarFiberTypeNameGaps = []string{
	grammarFiberTypeNameWitness,
	"effect function f() { enum fork { } }",
	"effect function f() { class C<join> { } }",
	"effect function f() { type join<T> = T }",
	"effect function f() { interface join { } }",
	"effect function f() { interface fork<T> { } }",
	"effect function f() { enum join { A } }",
	"effect function f() { const enum fork { A } }",
	"effect function f() { type T<join> = join }",
	"effect function f() { type fork = 1; const x: fork = 1 }",
	"const g = effect () => { type join = 1 }",
	"class C { effect m() { interface fork { } } }",
	"const p = effect { type fork = 1 };",
	"const p = effect { enum join { } };",
	"effect function outer() { function f<fork>() { } }",
	"effect function outer() { const f=effect <fork>() => 1 }",
	"effect function outer() { class C { effect m<fork>() { } } }",
}

func TestGrammarAdmissionFiberTypeNameKeys(t *testing.T) {
	for _, source := range grammarFiberTypeNameGaps {
		if got := grammarAdmissionForm(source); got != "admission:fiber-type-name" {
			t.Errorf("key=%q, want admission:fiber-type-name: %q", got, source)
		}
	}
	for _, source := range []string{
		// Plain code reserves neither word.
		"function g() { type fork = 1; interface join { } }",
		"effect function f<fork>() {}",
		"const f=effect <join>()=>1;",
		"class C{effect m<fork>(){}}",
		"type fork = 1; interface join { } enum fork2 { }",
		"effect function f() { function g() { type fork = 1 } }",
		"effect function f() { const g = () => { type join = 1 } }",
		"effect function f() { function g<T>() { } }",
		"effect function f() { type T=<fork>(x:fork)=>fork }",
		"effect function f() { type T=new<join>(x:join)=>object }",
		"effect function f() { type T={m<fork>(x:fork):fork} }",
		"effect function f() { type T={<join>(x:join):join} }",
		"effect function f() { type T<A>=A extends {n:infer fork}?fork:never }",
		"effect function f() { type T={[join in 'n']:number} }",
		// Other names, members and labels.
		"effect function f() { type forks = 1; interface joins { } }",
		"effect function f() { type T = { fork: number; join(): void } }",
		"effect function f() { type T = [fork: number] }",
		"effect function f() { enum E { fork, join } }",
		"effect function f() { const s = 'type fork = 1' }",
		// A bare fork block keeps its own key.
		"effect function f() { fork { return 1; } }",
		"fork {}",
	} {
		if got := grammarAdmissionForm(source); got == "admission:fiber-type-name" {
			t.Errorf("control keyed as a reserved type name: %q", source)
		}
	}
	for _, source := range []string{"effect function f() { fork { return 1; } }", "fork {}"} {
		if got := grammarAdmissionForm(source); got != "admission:fork-block" {
			t.Errorf("key=%q, want admission:fork-block: %q", got, source)
		}
	}
}

func TestGrammarAdmissionFiberTypeNameRegression(t *testing.T) {
	w := NewWorkspace(t)
	for _, source := range grammarFiberTypeNameGaps {
		t.Run(source, func(t *testing.T) {
			r, err := w.Compile(context.Background(), Single(source))
			if err != nil {
				t.Fatal(err)
			}
			count := 0
			for _, d := range r.Diagnostics {
				if IsEK(d) && d.Code() == 1702 {
					count++
				}
			}
			r.Remove()
			if count != 1 {
				t.Fatalf("want one EK1702 at a reserved declaration name, got %d", count)
			}

			checkGrammarAdmission(t, w, grammarAdmissionMutationKey(source), source)
		})
	}
	for _, source := range []string{
		"function g() { type fork = 1; interface join { } }",
		"effect function f() { type forks = 1; interface joins { } }",
		"effect function f() { function g() { type fork = 1 } }",
		"effect function f() { function g<T>() { } }",
		"effect function f() { type T = { fork: number; join(): void } }",
		// A value binding with either name is EK1702.
		"effect function f() { const fork = 1 }",
		"effect function f() { class join { } }",
		"effect function f() { declare const fork: number }",
	} {
		if grammarAdmissionVerdict(t, w, source) {
			t.Errorf("derived or syntax-rejected control became a gap: %q", source)
		}
	}
}

// These controls assert the TypeScript-derived compiler rule directly.
// General grammar-lab derivation coverage is independent of this declaration
// reservation check; no grammar-admission verdict is exempted here.
func TestReservedFiberTypeSyntaxCompilerControls(t *testing.T) {
	w := NewWorkspace(t)
	for _, source := range []string{
		"effect function f() { type T=<fork>(x:fork)=>fork }",
		"effect function f() { type T=new<join>(x:join)=>object }",
		"effect function f() { type T={m<fork>(x:fork):fork} }",
		"effect function f() { type T={<join>(x:join):join} }",
		"effect function f() { type T<A>=A extends {n:infer fork}?fork:never }",
		"effect function f() { type T={[join in 'n']:number} }",
	} {
		t.Run(source, func(t *testing.T) {
			r, err := w.Compile(t.Context(), Single(source))
			if err != nil {
				t.Fatal(err)
			}
			defer r.Remove()
			if errors := r3Errors(r.Diagnostics); len(errors) != 0 {
				t.Fatalf("valid native type syntax: %v", errors)
			}
		})
	}
}
