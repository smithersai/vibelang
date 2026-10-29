package vibelang

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
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

// D474, D501: EK4841's quick fix writes a schema constant and the type alias
// just after it as one schema alias, which the parser writes back into the same
// two declarations.
func TestSchemaAliasQuickFixes(t *testing.T) {
	for _, test := range []struct{ name, source, want string }{
		{"literals", "export const Kind = Schema.Literals([\"persistent\", \"incognito\"])\nexport type Kind = typeof Kind.Type\nexport const k: Kind = \"incognito\"\n",
			"export schema Kind = \"persistent\" | \"incognito\"\nexport const k: Kind = \"incognito\"\n"},
		{"a keyword schema", "export const Id = Schema.String\nexport type Id = typeof Id.Type\n",
			"export schema Id = string\n"},
		{"a union of other schemas", "schema A { a: string }\nconst AB = Schema.Union([A, Schema.Number, Schema.Null])\ntype AB = typeof AB.Type\nexport const ab: AB = null\n",
			"schema A { a: string }\nschema AB = A | number | null\nexport const ab: AB = null\n"},
		{"an array of tuples", "export const Pairs = Schema.Array(Schema.Tuple([Schema.String, Schema.Number]))\nexport type Pairs = typeof Pairs.Type\n",
			"export schema Pairs = ReadonlyArray<readonly [string, number]>\n"},
		{"a record", "export const Counts = Schema.Record(Schema.String, Schema.Number)\nexport type Counts = typeof Counts.Type\n",
			"export schema Counts = Readonly<Record<string, number>>\n"},
		{"a named schema", "export const Count = Schema.FiniteFromString\nexport type Count = typeof Count.Type\n",
			"export schema Count = Schema.FiniteFromString\n"},
		{"comments outside", "// The kinds.\nexport const Kind = Schema.Literals([\"a\", \"b\"]) // two\nexport type Kind = typeof Kind.Type\n",
			"// The kinds.\nexport schema Kind = \"a\" | \"b\" // two\n"},
	} {
		t.Run(test.name, func(t *testing.T) {
			got := applyQuickFix(t, test.source, EK4841.Code)
			if got != test.want {
				t.Fatalf("edited source differs:\ngot:\n%s\nwant:\n%s", got, test.want)
			}
			program, file, _, _ := editorProgram(t, got)
			for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
				if d.Category() == diagnostics.CategoryError || d.Source() == diagnosticSource && d.Code() == EK4841.Code {
					t.Errorf("the fixed source reports %s%d: %s", d.Source(), d.Code(), d.String())
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
		{"JSDoc on the type", "export const Kind = Schema.Literals([\"a\", \"b\"])\n/** The kinds. */\nexport type Kind = typeof Kind.Type\n"},
		{"another spelling of the type", "export const Kind = Schema.Literals([\"a\", \"b\"])\nexport type Kind = Schema.Schema.Type<typeof Kind>\n"},
		{"another export", "export const Kind = Schema.Literals([\"a\", \"b\"])\ntype Kind = typeof Kind.Type\nexport const k: Kind = \"a\"\n"},
		{"no type alias", "export const Kind = Schema.Literals([\"a\", \"b\"])\n"},
		// No schema alias writes the schema.
		{"a struct", "export const User = Schema.Struct({ id: Schema.String })\nexport type User = typeof User.Type\n"},
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
