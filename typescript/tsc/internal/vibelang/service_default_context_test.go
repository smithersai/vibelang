package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestServiceDefaultTryOutsideContext(t *testing.T) {
	const source = "// expect: EK0501\nexport effect function main() {\n const pending: (() => number)!! = Effect.succeed((): number => 1)\n service Called: number {\n  static readonly key = \"default-context/called\";\n  static readonly defaultValue = (try Effect.succeed((): number => 1)) as any\n }\n service Held: number {\n  static readonly key = \"default-context/held\";\n  static readonly defaultValue = (try pending) as any\n }\n service Parenthesized: number {\n  static readonly key = \"default-context/parenthesized\";\n  static readonly defaultValue = (try (Effect.succeed((): number => 1))) as any\n }\n return 1\n}\n"
	p, file, _, _ := editorProgram(t, source)
	count := 0
	for _, d := range p.GetSemanticDiagnostics(t.Context(), file) {
		if d.Source() != diagnosticSource || d.Code() != 501 {
			t.Errorf("unexpected diagnostic: %s", d.String())
		} else {
			count++
			notes := ""
			for _, chained := range d.MessageChain() {
				notes += chained.String() + "\n"
			}
			if !strings.Contains(notes, "capture it in the default factory") || strings.Contains(notes, "effect method") {
				t.Errorf("want the default-factory advice, got %q", notes)
			}
		}
	}
	if count != 3 {
		t.Fatalf("want three outside-effect try errors, got %d", count)
	}
}

func TestServiceDefaultContextControls(t *testing.T) {
	const source = "export effect function main() {\n const seed = try Effect.succeed(1)\n service Num: number {\n  static readonly key = \"default-context/valid\";\n  static readonly defaultValue = () => seed\n }\n return try Effect.service(Num)\n}\nexport class Ordinary { static readonly defaultValue = () => 1 }\n"
	p, file, _, _ := editorProgram(t, source)
	for _, d := range p.GetSemanticDiagnostics(t.Context(), file) {
		if d.Category() == diagnostics.CategoryError {
			t.Errorf("unexpected diagnostic: %s", d.String())
		}
	}
}
