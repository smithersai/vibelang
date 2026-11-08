package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"testing"
)

// The inverse preserves optionality and actual readonly modifiers under
// either option: Schema.optional(S) is written name?: T | undefined, which
// maps back to Schema.optional under both settings, and Schema.optionalKey has
// no spelling that does. A property named mutable remains an ordinary field.
func TestSchemaExactOptionalInverse(t *testing.T) {
	for _, key := range []string{"value", "mutable"} {
		for _, exact := range []bool{false, true} {
			for _, wrapper := range []string{"optional", "optionalKey"} {
				for _, mutable := range []bool{false, true} {
					name := key + "/" + wrapper + map[bool]string{false: "/default", true: "/exact"}[exact] + map[bool]string{false: "/readonly", true: "/writable"}[mutable]
					t.Run(name, func(t *testing.T) {
						value := "Schema." + wrapper + "(Schema.String)"
						if mutable {
							value = "Schema.mutableKey(" + value + ")"
						}
						source := "export const S = Schema.Struct({ " + key + ": " + value + " })\n"
						program, file, _, _ := editorProgram(t, source)
						program.Options().ExactOptionalPropertyTypes = core.BoolToTristate(exact)
						c, done := program.GetTypeCheckerForFile(t.Context(), file)
						defer done()
						c.GetDiagnostics(t.Context(), file)
						found := false
						var visit func(*ast.Node) bool
						visit = func(node *ast.Node) bool {
							if ast.IsPropertyAssignment(node) && node.Name().Text() == key {
								found = true
								text, ok := structFieldType(c, file, node, "  ")
								want := wrapper == "optional"
								if ok != want {
									t.Fatalf("exact=%t wrapper=%s: convertible=%t want=%t (%s)", exact, wrapper, ok, want, text)
								}
								if ok {
									native := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/flags.ts", PathKey: "/flags.ts"}, "interface Flags { "+text+" }", core.ScriptKindTS)
									if len(native.Diagnostics()) != 0 {
										t.Fatalf("invalid native member: %s", text)
									}
									members := native.Statements.Nodes[0].Members()
									if len(members) != 1 || !ast.IsPropertySignatureDeclaration(members[0]) || members[0].Name().Text() != key || members[0].QuestionToken() == nil || ast.HasSyntacticModifier(members[0], ast.ModifierFlagsReadonly) == mutable {
										t.Fatalf("lost native optionality or readonly modifier: mutable=%t %s", mutable, text)
									}
								}
							}
							return node.ForEachChild(visit)
						}
						file.AsNode().ForEachChild(visit)
						if !found {
							t.Fatal("missing control field")
						}
					})
				}
			}
		}
	}
}

// Optional sugar removes explicit undefined union arms. A repair must retain
// an already-written Union codec whose declaration would otherwise change,
// and a codec of undefined alone, which name?: undefined | undefined would
// not map back to.
func TestSchemaOptionalExplicitUnionInverse(t *testing.T) {
	for _, row := range []struct {
		name, prefix, codec string
		convertible         bool
	}{
		{"string", "", "Schema.optional(Schema.String)", true},
		{"undefined-only", "", "Schema.optional(Schema.Undefined)", false},
		{"explicit-undefined-union", "", "Schema.optional(Schema.Union([Schema.String, Schema.Undefined]))", false},
		{"undefined-first", "", "Schema.optional(Schema.Union([Schema.Undefined, Schema.String]))", false},
		{"mutable-undefined-union", "", "Schema.mutableKey(Schema.optional(Schema.Union([Schema.String, Schema.Undefined])))", false},
		{"undefined-only-union", "", "Schema.optional(Schema.Union([Schema.Undefined, Schema.Undefined]))", false},
		{"required-union", "", "Schema.Union([Schema.String, Schema.Undefined])", true},
		{"nullable-union", "", "Schema.optional(Schema.Union([Schema.String, Schema.Null]))", true},
		{"reference-union", "const U = Schema.Undefined; ", "Schema.optional(Schema.Union([Schema.String, U]))", true},
		{"nested-optional-union", "", "Schema.Struct({ inside: Schema.optional(Schema.Union([Schema.String, Schema.Undefined])) })", false},
	} {
		t.Run(row.name, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, row.prefix+"export const S = Schema.Struct({ value: "+row.codec+" })\n")
			program.Options().ExactOptionalPropertyTypes = core.TSFalse
			c, done := program.GetTypeCheckerForFile(t.Context(), file)
			defer done()
			c.GetDiagnostics(t.Context(), file)
			found := false
			var visit func(*ast.Node) bool
			visit = func(node *ast.Node) bool {
				if ast.IsPropertyAssignment(node) && node.Name().Text() == "value" {
					found = true
					text, ok := structFieldType(c, file, node, "  ")
					if ok != row.convertible {
						t.Fatalf("convertible=%t want=%t: %s", ok, row.convertible, text)
					}
					return true
				}
				return node.ForEachChild(visit)
			}
			file.AsNode().ForEachChild(visit)
			if !found {
				t.Fatal("missing control field")
			}
		})
	}
}
