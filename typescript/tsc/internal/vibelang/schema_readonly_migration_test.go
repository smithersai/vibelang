package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
	"strings"
	"testing"
)

func TestSchemaWritableFieldMapping(t *testing.T) {
	source := "schema State { value:number; note?:string; nested:{ active:boolean }; readonly items:readonly number[]; locked:readonly number[] }\nconst state:State={value:1,nested:{active:false},items:[1],locked:[1]}\nstate.value=2;state.note=\"ok\";state.nested.active=true;state.locked=[3]\n"
	program, file, _, _ := editorProgram(t, source)
	for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
		if d.Category() == diagnostics.CategoryError {
			t.Errorf("writable key rejected: %s", d.String())
		}
	}
}

func TestSchemaReadonlyMigration(t *testing.T) {
	for _, test := range []struct {
		source   string
		count    int
		contains []string
	}{
		{"schema S {value:number;maybe?:string;nested:{flag:boolean};readonly fixed:string;mutable open:number;mutable?:number}\n", 5, []string{"readonly value", "readonly maybe?", "readonly nested", "readonly flag", "readonly fixed", "mutable open", "readonly mutable?"}},
		{"namespace N {export schema A=ReadonlyArray<{value:number;readonly fixed:string;mutable open:number}>}\n", 1, []string{"readonly value", "readonly fixed", "mutable open"}},
		{"schema error E {value:{flag:boolean};method():{keep:number}{return {keep:1}}}\n", 1, []string{"value:{readonly flag", "method():{keep:number}"}},
		{"abstract schema error Base {value:{flag:boolean}}\nschema error Child extends Base {extra:{n:number}}\n", 2, []string{"value:{readonly flag", "extra:{readonly n"}},
	} {
		t.Run(test.source, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, test.source)
			p := schemaReadonlyMigrationFixes(t.Context(), program, file, map[string]bool{})
			if len(p.fixes) != test.count {
				t.Fatalf("got%d upgrades,want%d:\n%s", len(p.fixes), test.count, p.text())
			}
			fixed := p.text()
			for _, want := range test.contains {
				if !strings.Contains(fixed, want) {
					t.Errorf("missing%s:\n%s", want, fixed)
				}
			}
			again, nextFile, _, _ := editorProgram(t, fixed)
			if next := schemaReadonlyMigrationFixes(t.Context(), again, nextFile, map[string]bool{}); len(next.fixes) != 0 {
				t.Fatalf("not idempotent:\n%s", next.text())
			}
		})
	}
}

func TestSchemaWritableInverseKeepsReadonly(t *testing.T) {
	for _, test := range []struct{ source, want string }{
		{"const S=Schema.Struct({value:Schema.Number})\n", "schema S { readonly value: number }"},
		{"const S=Schema.Struct({value:Schema.mutableKey(Schema.Number)})\n", "schema S { value: number }"},
	} {
		fixed := applyQuickFix(t, test.source, EK4832.Code)
		if !strings.Contains(fixed, test.want) {
			t.Fatalf("got%s\nwant%s", fixed, test.want)
		}
	}
}

func TestSchemaReadonlyMigrationCodecReferences(t *testing.T) {
	for _, source := range []string{
		"const Mutable=Schema.mutableKey(Schema.Number)\nexport schema S {value:Mutable;grouped:(\"a\"|\"b\")|null;object:({child:{flag:boolean};mutable open:number}|null)|undefined}\n",
		"const Mutable=Schema.mutableKey(Schema.Number)\nexport schema S {value:Mutable; count:number}\n",
		"const Mutable=Schema.mutableKey(Schema.Number)\nschema error E {value:{n:Mutable;count:number}}\n",
		"const Mutable=Schema.mutableKey(Schema.Number)\nabstract schema error E {value:{n:Mutable;count:number}}\nschema error Child extends E {}\n",
		"\"use client\";\nconst Mutable=Schema.mutableKey(Schema.Number)\nnamespace N {const Schema=1;export schema S {value:Mutable;count:number}}\n",
	} {
		t.Run(source, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, source)
			p := schemaReadonlyMigrationFixes(t.Context(), program, file, map[string]bool{})
			if len(p.fixes) == 0 {
				t.Fatal("no upgrade")
			}
			fixed := p.text()
			if strings.Contains(fixed, "readonly value:Mutable") || strings.Contains(fixed, "readonly n:Mutable") || strings.Contains(fixed, "Schema.mutableKey(Mutable)") {
				t.Fatalf("changed old codec:\n%s", fixed)
			}
			if strings.Contains(source, "grouped:") {
				if !strings.Contains(fixed, ".Union([Schema.Literals([\"a\", \"b\"]), Schema.Null])") || !strings.Contains(fixed, ".Union([Schema.Union([Schema.Struct(") || strings.Count(fixed, ".mutableKey(") != 2 {
					t.Fatalf("lost combined readonly/grouping upgrade:\\n%s", fixed)
				}
			}
			if !strings.Contains(fixed, "Struct(") {
				t.Fatalf("did not keep explicit codec:\n%s", fixed)
			}
			next, nextFile, _, _ := editorProgram(t, fixed)
			for _, d := range append(next.GetSyntacticDiagnostics(t.Context(), nextFile), next.GetSemanticDiagnostics(t.Context(), nextFile)...) {
				if d.Category() == diagnostics.CategoryError {
					t.Errorf("fixed:%s\n%s", d.String(), fixed)
				}
			}
			if again := schemaReadonlyMigrationFixes(t.Context(), next, nextFile, map[string]bool{}); len(again.fixes) != 0 {
				t.Fatalf("not idempotent:\n%s", again.text())
			}
		})
	}
}

func TestSchemaWritableFieldReferenceHover(t *testing.T) {
	source := "const Codec=Schema.Number\nschema S {value:Codec}\n"
	_, file, service, _ := editorProgram(t, source)
	text := hoverText(t, service, lsconv.FileNameToDocumentURI(file.FileName()), lsproto.Position{Line: 1, Character: 17})
	if !strings.Contains(text, "Codec") {
		t.Fatalf("field codec lost hover:%q", text)
	}
}

func TestSchemaWritableRefactorPreservesKeys(t *testing.T) {
	source := "interface Person {readonly value:number;mutable open:number;nested:{readonly name:string}}"
	program, file, service, converters := editorProgram(t, source)
	pos := strings.Index(source, "Person")
	actions := vibelangRefactors(t.Context(), &ls.RefactorContext{SourceFile: file, Span: core.NewTextRange(pos, pos), Program: program, LS: service})
	for _, action := range actions {
		if action.Description == "Convert to a schema declaration" {
			fixed := applyEditorEdits(t, file, converters, action.Changes)
			if !strings.Contains(fixed, "readonly value") || strings.Contains(fixed, "readonly nested") || !strings.Contains(fixed, "readonly name") || strings.Contains(fixed, "mutable open") || strings.Contains(fixed, "readonly open") {
				t.Fatal(fixed)
			}
			return
		}
	}
	t.Fatal("missing schema refactor")
}

func TestSchemaReadonlyMigrationKeepsInvalidForms(t *testing.T) {
	source := "schema Event {when:Date;run():void}\n"
	program, file, _, _ := editorProgram(t, source)
	p := schemaReadonlyMigrationFixes(t.Context(), program, file, map[string]bool{})
	fixed := p.text()
	if strings.Contains(fixed, "const Event") || !strings.Contains(fixed, "readonly when:Date") {
		t.Fatal(fixed)
	}
}

func TestLegacySchemaReadonlyType(t *testing.T) {
	source := "{value:number;nested:{flag:boolean};readonly fixed:string;mutable open:number}"
	fixed := preserveLegacySchemaReadonlyType(source)
	for _, want := range []string{"readonly value", "readonly nested", "readonly flag", "readonly fixed", "mutable open:number"} {
		if !strings.Contains(fixed, want) {
			t.Fatalf("lost legacy key flags: %s", fixed)
		}
	}
	if strings.Contains(fixed, "readonly open") {
		t.Fatal(fixed)
	}
	if again := preserveLegacySchemaReadonlyType(fixed); again != fixed {
		t.Fatalf("not idempotent: %s", again)
	}
}
