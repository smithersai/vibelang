package vibelang

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
)

func TestOptionMatchNamedImportNoPanic(t *testing.T) {
	source := `import { match as optionMatch } from "effect/Option"
export effect function main() {
  return optionMatch(Option.some(1), { onNone: () => 0, onSome: (n) => n + 1 })
}
`
	p, file, _, _ := editorProgram(t, source)
	diags := p.GetSemanticDiagnostics(t.Context(), file)
	var sawEK4839 bool
	for _, d := range diags {
		if d.Code() == EK4839.Code {
			sawEK4839 = true
		}
	}
	if !sawEK4839 {
		t.Fatalf("expected EK4839 warning on named-import Option.match, got %v", diags)
	}
	c, done := p.GetTypeChecker(t.Context())
	defer done()
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		if optionMatchOf(c, n) {
			_ = optionMatchRewrite(c, file, n)
		}
		return n.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

func TestMatchChainMissingReturnExpressionNoPanic(t *testing.T) {
	source := `export const f = (x: "a" | "b") => Match.value(x).pipe(
  Match.when("a", () => { const y = 1; return : }),
  Match.orElse(() => 2),
)
export effect function main() { return 1 }
`
	p, file, _, _ := editorProgram(t, source)
	diags := p.GetSemanticDiagnostics(t.Context(), file)
	var sawEK4839 bool
	for _, d := range diags {
		if d.Code() == EK4839.Code {
			sawEK4839 = true
		}
	}
	if !sawEK4839 {
		t.Fatalf("expected EK4839 warning on Match chain with incomplete return, got %v", diags)
	}
	c, done := p.GetTypeChecker(t.Context())
	defer done()
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		if matchChainOf(c, n) != nil {
			_ = matchChainRewrite(c, file, n)
		}
		return n.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

func TestLegacyServiceDefaultWithComputedStaticMemberNoPanic(t *testing.T) {
	source := `const k = "x"
service Cache {
  static readonly default = { get: () => 1 }
  static [k] = 2
  get(): number
}
export effect function main() { return 1 }
`
	p, file, _, _ := editorProgram(t, source)
	diags := p.GetSemanticDiagnostics(t.Context(), file)
	var sawEK4855 bool
	for _, d := range diags {
		if d.Code() == EK4855.Code {
			sawEK4855 = true
		}
	}
	if !sawEK4855 {
		t.Fatalf("expected EK4855 warning on legacy static default, got %v", diags)
	}
	c, done := p.GetTypeChecker(t.Context())
	defer done()
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		if legacyDefault(n) {
			_ = legacyDefaultRewrite(c, file, n)
		}
		return n.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}
