package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// RC-40: the utility type can be shadowed in any lexical scope. A migration
// must retain both the service read and the user's unrelated ReturnType.
func TestVIP9DefaultValueMigrationReturnTypeShadows(t *testing.T) {
	for _, scope := range []struct{ name, prefix, suffix string }{
		{"local", "type ReturnType<T> = { wrong: true }\n", "\nexport const user: ReturnType<never> = { wrong: true }\n"},
		{"namespace", "export namespace Reads {\ntype ReturnType<T> = { wrong: true }\n", "\nexport const user: ReturnType<never> = { wrong: true }\n}\n"},
		{"parameter", "export function scoped<ReturnType>() {\n", "\nreturn same\n}\n"},
		{"infer-name", "type __VibeDefault = { wrong: true }\n", "\nexport const user: __VibeDefault = { wrong: true }\n"},
		{"value-only", "const ReturnType = 1\n", "\nexport const user = ReturnType\n"},
	} {
		t.Run(scope.name, func(t *testing.T) {
			service := "service Flags { static readonly key = \"rc40/Flags\"; static readonly default: Flags.Shape = { enabled: true }; enabled: boolean }\n"
			reads := "type Value = typeof Flags.default\n" +
				"type Indexed = (typeof Flags)[\"default\"]\n" +
				"type Member = typeof Flags.default.enabled\n" +
				"type Projection = (typeof Flags.default)[\"enabled\"]\n" +
				"type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false\n" +
				"const same: [Equal<Value, Flags.Shape>, Equal<Indexed, Flags.Shape>, Equal<Member, boolean>, Equal<Projection, boolean>] = [true, true, true, true]\n"
			source := service + scope.prefix + reads + scope.suffix
			fixed := applyQuickFix(t, source, EK4855.Code)
			if !strings.HasPrefix(fixed, "service Flags") || !strings.Contains(fixed, scope.prefix) || !strings.Contains(fixed, scope.suffix) {
				t.Fatalf("changed a user binding:\n%s", fixed)
			}
			program, file, _, _ := editorProgram(t, fixed)
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Category() == diagnostics.CategoryError || d.Code() == EK4855.Code {
					t.Errorf("repaired file: %s\n%s", d.String(), fixed)
				}
			}
		})
	}
}
