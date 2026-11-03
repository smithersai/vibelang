package vibelang

import (
	"fmt"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestEffectOperationOperands(t *testing.T) {
	for _, rule := range []struct {
		name, typ string
		allowed   bool
	}{
		{"never", "never", true},

		{"any", "any", true},
		{"Effect", "Effect.Effect<number, string>", true},
		{"brand", "Effect.Effect<number> & { readonly brand: string }", true},
		{"Config", "Config.Config<number>", true},
		{"unknown", "unknown", false},
		{"number", "number", false},
		{"optional", "Effect.Effect<number> | undefined", false},
		{"forged variance", "Pick<Effect.Effect<number>, \"~effect/Effect\">", false},
	} {
		for _, shape := range []string{"value", "call", "parenthesized"} {
			for _, op := range []struct {
				name, body string
				code       int32
			}{
				{"try", "return try %s", 502},
				{"catch", "return %s catch (() => 0)", 506},
				{"all", "return try.all [%s]", 1801},
				{"fork", "const fiber = fork %s; return 0", 1703},
			} {
				t.Run(rule.name+"/"+shape+"/"+op.name, func(t *testing.T) {
					operand := "input"
					if shape == "call" {
						operand = "make()"
					}
					if shape == "parenthesized" {
						operand = "(make())"
					}
					source := fmt.Sprintf("declare const input: %s; /** @throws {never} */\ndeclare function make(): typeof input; export effect function probe() { %s }", rule.typ, fmt.Sprintf(op.body, operand))
					program, file, _, _ := editorProgram(t, source)
					found := false
					for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
						if d.Source() == "EK" && d.Code() == op.code {
							found = true
						}
						if rule.allowed && d.Category() == diagnostics.CategoryError {
							t.Errorf("unexpected %s%d: %s", d.Source(), d.Code(), d.MessageText())
						}
					}
					if found == rule.allowed {
						t.Errorf("operand diagnostic=%v, allowed=%v\n%s", found, rule.allowed, source)
					}
				})
			}
		}
	}
}

func TestEffectOperandConstraints(t *testing.T) {
	for _, source := range []string{
		"export effect function probe<T extends Effect.Effect<number>>(input: T) { return try input }",
		"export effect function probe<T extends Effect.Effect<number>>(input: T) { return input catch (() => 0) }",
		"export effect function probe<T extends Effect.Effect<number>>(input: T) { const f = fork input; return 0 }",
		"export effect function probe<T extends Effect.Effect<number>>(input: T) { return try.all [input] }",
	} {
		program, file, _, _ := editorProgram(t, source)
		for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
			if d.Category() == diagnostics.CategoryError {
				t.Errorf("%s%d: %s\n%s", d.Source(), d.Code(), d.MessageText(), source)
			}
		}
	}
}
