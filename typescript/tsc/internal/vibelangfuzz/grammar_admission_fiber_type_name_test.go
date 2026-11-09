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

// grammarFiberTypeName reports a type alias, interface, enum or type
// parameter named fork or join in effect code: inside the body of an Effect
// callable or block, or among an Effect callable's own type parameters. The
// compiler reports EK1702 for a value binding with either name and nothing
// for these. A member, a tuple label, and a nested plain function's own type
// parameters and declarations are outside the reservation.
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
			if name := n.Name(); reserved(name) && grammarAdmissionEffectAt(file, name.End()-1) {
				return true
			}
		}
		if ast.IsFunctionLike(n) {
			if n.Flags&ast.NodeFlagsVibeLangEffect != 0 {
				for _, parameter := range n.TypeParameters() {
					if reserved(parameter.Name()) {
						return true
					}
				}
			}
			// A plain callable's own type parameters take its own context,
			// as its parameters do.
			return n.ForEachChild(func(child *ast.Node) bool {
				return child.Kind != ast.KindTypeParameter && visit(child)
			})
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
	"effect function f<fork>() { }",
	"effect <fork>() => 1",
	"class C { effect m<fork>() { } }",
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
		"type fork = 1; interface join { } enum fork2 { }",
		"effect function f() { function g() { type fork = 1 } }",
		"effect function f() { const g = () => { type join = 1 } }",
		"effect function f() { function g<fork>() { } }",
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
			if !grammarAdmissionVerdict(t, w, source) {
				r, _ := w.Compile(context.Background(), Single(source))
				t.Fatalf("witness no longer exposes an admission gap: %v", r.Diagnostics)
			}
			checkGrammarAdmission(t, w, grammarAdmissionMutationKey(source), source)
		})
	}
	for _, source := range []string{
		"function g() { type fork = 1; interface join { } }",
		"effect function f() { type forks = 1; interface joins { } }",
		"effect function f() { function g() { type fork = 1 } }",
		"effect function f() { function g<fork>() { } }",
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
