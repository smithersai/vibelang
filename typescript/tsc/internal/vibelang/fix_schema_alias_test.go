package vibelang

import (
	"testing"
)

// Chapter 27 requires diagnostics for syntax errors, including a missing
// initializer whose trivia ends after its zero-width recovery node.
func TestSchemaAliasMissingInitializer(t *testing.T) {
	for _, source := range []string{
		"const A0= ",
		"const A0= /* missing */ ",
		"type A0 = typeof A0.Type\nconst A0= \n",
	} {
		t.Run(source, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, source)
			if len(program.GetSyntacticDiagnostics(t.Context(), file)) == 0 {
				t.Fatal("missing initializer must report a syntax error")
			}
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Source() == diagnosticSource && d.Code() == EK4841.Code {
					t.Fatalf("missing initializer reports EK4841: %s", d.String())
				}
			}
		})
	}
}

// Where a schema alias would say something else, or would change the
// module's declaration file, EK4841 says nothing.
func TestSchemaAliasNotReported(t *testing.T) {
	for _, test := range []struct{ name, source string }{
		// The declaration file lists an alias's constant first (D501).
		{"the type before its constant", "export type Kind = typeof Kind.Type\nexport const Kind = Schema.Literals([\"a\", \"b\"])\n"},
		{"a statement between", "export const Kind = Schema.Literals([\"a\", \"b\"])\nexport const other = 1\nexport type Kind = typeof Kind.Type\n"},
		{"JSDoc on the constant", "/** The kinds. */\nexport const Kind = Schema.Literals([\"a\", \"b\"])\nexport type Kind = typeof Kind.Type\n"},
		{"another spelling of the type", "export const Kind = Schema.Literals([\"a\", \"b\"])\nexport type Kind = Schema.Schema.Type<typeof Kind>\n"},
		{"another export", "export const Kind = Schema.Literals([\"a\", \"b\"])\ntype Kind = typeof Kind.Type\nexport const k: Kind = \"a\"\n"},
		{"no type alias", "export const Kind = Schema.Literals([\"a\", \"b\"])\n"},
		// No schema alias writes the schema.
		{"a transformation", "export const Name = Schema.NullOr(Schema.String)\nexport type Name = typeof Name.Type\n"},
		{"a pipe", "export const Id = Schema.String.pipe(Schema.brand(\"Id\"))\nexport type Id = typeof Id.Type\n"},
		{"a comment inside", "export const Kind = Schema.Literals([\"a\", /* the other */ \"b\"])\nexport type Kind = typeof Kind.Type\n"},
		{"an annotation", "export const Kind: Schema.Literals<readonly [\"a\", \"b\"]> = Schema.Literals([\"a\", \"b\"])\nexport type Kind = typeof Kind.Type\n"},
		{"a schema alias already", "export schema Kind = \"a\" | \"b\"\n"},
	} {
		t.Run(test.name, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, test.source)
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Source() == diagnosticSource && d.Code() == EK4841.Code {
					t.Fatalf("unexpected EK4841: %s", d.String())
				}
			}
		})
	}
}
