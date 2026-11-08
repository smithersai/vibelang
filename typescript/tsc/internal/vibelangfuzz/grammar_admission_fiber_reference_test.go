package vibelangfuzz

import (
	"context"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
)

const grammarFiberReferenceQuote = "An `IdentifierReference`, `BindingIdentifier` or `LabelIdentifier` can't be `fork` or `join`"

// grammarFiberPrimaryReference reports fork or join at the head of a new
// callee or an extends clause in Effect code. Appendix A reserves both words
// wherever an IdentifierReference could stand there. These positions begin at
// a primary expression, so they need the same EK1702 reservation as bindings.
func grammarFiberPrimaryReference(file *ast.SourceFile) bool {
	// A MemberExpression continues through member access, a non-null
	// assertion and a tagged template before its primary head.
	head := func(n *ast.Node) *ast.Node {
		for n != nil {
			switch {
			case ast.IsPropertyAccessExpression(n) || ast.IsElementAccessExpression(n) || ast.IsNonNullExpression(n):
				n = n.Expression()
			case ast.IsTaggedTemplateExpression(n):
				n = n.AsTaggedTemplateExpression().Tag
			default:
				return n
			}
		}
		return n
	}
	found := false
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		if found {
			return true
		}
		var target *ast.Node
		switch {
		case ast.IsNewExpression(n):
			target = head(n.Expression())
		case ast.IsExpressionWithTypeArguments(n) && n.Parent != nil && ast.IsHeritageClause(n.Parent):
			target = head(n.Expression())
		}
		if target != nil && ast.IsIdentifier(target) && (target.Text() == "fork" || target.Text() == "join") &&
			grammarAdmissionEffectAt(file, target.End()-1) {
			found = true
			return true
		}
		n.ForEachChild(visit)
		return found
	}
	file.AsNode().ForEachChild(visit)
	return found
}

var grammarFiberReferenceGaps = []string{
	"effect function f ( ) { return new join . target ; }",
	"effect function f() { return new join.target; }",
	"effect function f() { return new join\n.target; }",
	"effect function f() { return new join; }",
	"effect function f(x) { return new join(x); }",
	"effect function f() { return new join[0]; }",
	"effect function f() { return new fork.target; }",
	"effect function f() { return new fork; }",
	"effect () => new join.target",
	"effect function f() { return class extends join {}; }",
	"effect function f() { return class extends fork.C {}; }",
	"effect function f ( ) { return new join . target ! }",
	"effect function f() { return new join!.target; }",
	"effect function f() { return class extends join! {}; }",
}

var grammarFiberReferenceControls = []string{
	"function f() { return new join.target; }",
	"const x = new join.target;",
	"effect function f() { const g = () => new join.target; }",
	"effect function f() { const g = function () { return new join.target; }; }",
	"effect function f() { return new x.join; }",
	"effect function f() { return new (join).target; }",
	"effect function f() { return { join }; }",
	"effect function f() { return x?.join; }",
	"class C extends join {}",
}

func TestGrammarAdmissionFiberReferenceQuoted(t *testing.T) {
	if !strings.Contains(SpecText(grammarAppendix), grammarFiberReferenceQuote) {
		t.Fatalf("the Appendix A fork/join reservation changed: %s", grammarFiberReferenceQuote)
	}
}

func TestGrammarAdmissionFiberReferenceKeys(t *testing.T) {
	for _, source := range grammarFiberReferenceGaps {
		if got := grammarAdmissionForm(source); got != "admission:fiber-primary-reference" {
			t.Errorf("key=%q, want admission:fiber-primary-reference: %q", got, source)
		}
	}
	for _, source := range grammarFiberReferenceControls {
		if got := grammarAdmissionForm(source); got == "admission:fiber-primary-reference" {
			t.Errorf("control keyed as a reserved primary reference: %q", source)
		}
	}
}

func TestGrammarAdmissionFiberReferenceRegression(t *testing.T) {
	w := NewWorkspace(t)
	for _, source := range grammarFiberReferenceGaps {
		t.Run(source, func(t *testing.T) {
			if grammarAdmissionVerdict(t, w, source) {
				r, _ := w.Compile(context.Background(), Single(source))
				t.Fatalf("reserved reference still exposes an admission gap: %v", r.Diagnostics)
			}
			checkGrammarAdmission(t, w, grammarAdmissionMutationKey(source), source)
		})
	}
	// Plain code keeps ordinary identifiers, a parenthesized or shorthand
	// reference is already rejected, and a member name is never reserved.
	for _, source := range grammarFiberReferenceControls {
		t.Run(source, func(t *testing.T) {
			if grammarAdmissionVerdict(t, w, source) {
				t.Fatalf("control became an admission gap: %q", source)
			}
		})
	}
}
