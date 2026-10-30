package vibelang

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestSchemaReadonlyFieldReferenceFlags(t *testing.T) {
	source := "const Mutable=Schema.mutableKey(Schema.Number)\nconst Alias=Mutable\nconst Uncertain=Mutable as Schema.Top\nschema Direct { readonly value: Mutable; readonly maybe?: Mutable }\nschema Aliased { readonly value: Alias }\nschema Wide { readonly value: Uncertain }\nschema Nested { readonly child: { readonly value: Mutable } }\nnamespace N { export schema Named { readonly value: Mutable } }\nschema error Outer { readonly child: { readonly value: Mutable } }\n"
	program, file, _, _ := editorProgram(t, source)
	count := 0
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		if d.Source() == diagnosticSource && d.Code() == EK2109.Code && strings.HasPrefix(d.String(), "A readonly schema field") {
			count++
		}
	}
	if count != 7 {
		t.Fatalf("got %d readonly reference errors, want 7", count)
	}
}

func TestSchemaReadonlyFieldReferenceControls(t *testing.T) {
	source := "const Mutable=Schema.mutableKey(Schema.Number)\nconst Readonly=Schema.Number\nconst MutableArray=Schema.mutable(Schema.Array(Schema.Number))\nschema Writable { value: Mutable; maybe?: Mutable }\nschema Good { readonly value: Readonly; readonly maybe?: Readonly; readonly array: MutableArray; readonly nested: { value: Mutable } }\n"
	program, file, _, _ := editorProgram(t, source)
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		if d.Source() == diagnosticSource && d.Code() == EK2109.Code {
			t.Fatalf("valid shallow readonly/control rejected: %s", d.String())
		}
	}
}

func TestSchemaReadonlyFieldReferenceInverseSafety(t *testing.T) {
	source := "const Mutable=Schema.mutableKey(Schema.Number)\nexport const Codec=Schema.Struct({value:Mutable})\nexport type Codec=typeof Codec.Type\n"
	program, file, _, _ := editorProgram(t, source)
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		if d.Source() == diagnosticSource && d.Code() == EK4832.Code {
			t.Fatalf("unsafe inverse: %s", d.String())
		}
	}
}

func TestSchemaReadonlyFieldReferenceFix(t *testing.T) {
	for _, source := range []string{
		"const Mutable=Schema.mutableKey(Schema.Number)\nexport schema Direct { readonly value: Mutable; readonly maybe?: Mutable }\n",
		"const Mutable=Schema.mutableKey(Schema.Number)\nnamespace N { const Schema=1; export schema Named { readonly value: Mutable } }\n",
		"const Mutable=Schema.mutableKey(Schema.Number)\nexport abstract schema error Parent { id: string }\nexport schema error Child extends Parent { readonly child: { readonly value: Mutable } }\n",
	} {
		fixed := applyQuickFixOf(t, source, EK2109.Code, diagnostics.CategoryError)
		program, file, _, _ := editorProgram(t, fixed)
		for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
			if d.Category() == diagnostics.CategoryError {
				t.Errorf("fixed source reports %s:\n%s", d.String(), fixed)
			}
		}
	}
}

func TestFixProjectSchemaReadonlyFieldReference(t *testing.T) {
	root, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatal(err)
	}
	fixture := filepath.Join(root, "typescript/vibelang/cases/schema-readonly-field-reference-upgrade")
	before, err := os.ReadFile(filepath.Join(fixture, "main.before.vibe.txt"))
	if err != nil {
		t.Fatal(err)
	}
	want, err := os.ReadFile(filepath.Join(fixture, "main.vibe"))
	if err != nil {
		t.Fatal(err)
	}
	dir := copyCompilerFixture(t, fixture, root)
	main := filepath.Join(dir, "main.vibe")
	if err := os.WriteFile(main, before, 0600); err != nil {
		t.Fatal(err)
	}
	result := fixCase(t, dir)
	if result.Err != nil || len(result.Files) != 1 || len(result.Refused) != 0 {
		t.Fatalf("fix: %+v", result)
	}
	var got string
	for _, fixed := range result.Files {
		got = fixed.Text
	}
	if got != string(want) {
		t.Fatalf("--fix writes:\n%s\nwant:\n%s", got, want)
	}
	if err := os.WriteFile(main, []byte(got), 0600); err != nil {
		t.Fatal(err)
	}
	if again := fixCase(t, dir); again.Err != nil || len(again.Files) != 0 {
		t.Fatalf("second fix: %+v", again)
	}
}

func TestSchemaReadonlyFieldReferenceSourceKeys(t *testing.T) {
	source := "const Mutable=Schema.mutableKey(Schema.Number)\nconst key=Symbol(\"key\")\nconst dynamic:string=\"dynamic\"\nschema Keys {\n readonly \"a-b\": Mutable\n readonly 1: Mutable\n readonly [key]: Mutable\n readonly [dynamic]: Mutable\n readonly café: Mutable\n}\n"
	program, file, _, _ := editorProgram(t, source)
	count := 0
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		if d.Source() == diagnosticSource && d.Code() == EK2109.Code && strings.HasPrefix(d.String(), "A readonly schema field") {
			count++
		}
	}
	if count != 5 {
		t.Fatalf("got %d quoted/numeric/computed/unicode key errors, want5", count)
	}
	fixed := applyQuickFixOf(t, source, EK2109.Code, diagnostics.CategoryError)
	program, file, _, _ = editorProgram(t, fixed)
	for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
		if d.Category() == diagnostics.CategoryError {
			t.Errorf("computed field fix reports %s:\n%s", d.String(), fixed)
		}
	}
}
