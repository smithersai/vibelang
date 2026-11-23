package vibelang

import (
	"testing"
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
}
