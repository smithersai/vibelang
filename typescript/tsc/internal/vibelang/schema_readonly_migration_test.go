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

// rule-evidence: docs/design/src/007-tooling.md#fix-scopes | Ordinary checking and `--fix` keep the current writable defaults.
func TestSchemaWritableFieldMapping(t *testing.T) {
	source := "schema State { value:number; note?:string; nested:{ active:boolean }; readonly items:readonly number[]; locked:readonly number[] }\nconst state:State={value:1,nested:{active:false},items:[1],locked:[1]}\nstate.value=2;state.note=\"ok\";state.nested.active=true;state.locked=[3]\n"
	program, file, _, _ := editorProgram(t, source)
	for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
		if d.Category() == diagnostics.CategoryError {
			t.Errorf("writable key rejected: %s", d.String())
		}
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
