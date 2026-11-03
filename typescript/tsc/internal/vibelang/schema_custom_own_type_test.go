package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// VIP-34 requires associated types to survive schema repairs, even when a
// custom helper has exactly the library helper's spelling.
func TestSchemaCustomOwnType(t *testing.T) {
	for _, test := range []struct {
		name, prefix, own string
		allowed           bool
	}{
		{"custom literal alias", `namespace Schema { export namespace Schema { export type Type<T> = "sentinel" } }`, `export type User = Schema.Schema.Type<typeof User>;`, false},
		{"custom object alias", `namespace Schema { export namespace Schema { export type Type<T> = { readonly brand: "custom" } } }`, `export type User = Schema.Schema.Type<typeof User>;`, false},
		{"custom interface", `namespace Schema { export namespace Schema { export type Type<T> = { readonly brand: "custom" } } }`, `export interface User extends Schema.Schema.Type<typeof User> {}`, false},
		{"renamed custom", `namespace Other { export namespace Schema { export type Type<T> = "sentinel" } }`, `export type User = Other.Schema.Type<typeof User>;`, false},
		{"real helper alias", `import * as Schema from "effect/Schema";`, `export type User = Schema.Schema.Type<typeof User>;`, true},
		{"real helper interface", `import * as Schema from "effect/Schema";`, `export interface User extends Schema.Schema.Type<typeof User> {}`, true},
		{"own type query", ``, `export type User = typeof User.Type;`, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			source := "import {Schema as S} from 'effect';\n" + test.prefix + "\nexport const User = S.Struct({});\n" + test.own + "\n"
			program, file, _, _ := editorProgram(t, source)
			warned := false
			for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
				if d.Category() == diagnostics.CategoryError {
					t.Fatalf("invalid fixture: %s", d.String())
				}
				if d.Source() == diagnosticSource && d.Code() == 4832 {
					warned = true
				}
			}
			if warned != test.allowed {
				t.Fatalf("EK4832 offered=%v, want %v; custom associated types must survive", warned, test.allowed)
			}
			if test.allowed {
				got := applyQuickFix(t, source, 4832)
				if !strings.Contains(got, "export schema User {}") {
					t.Fatalf("real own type not repaired: %s", got)
				}
			}
		})
	}
}
