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

// rule-evidence: docs/design/src/007-tooling.md#explicit-source-changes | Diagnostics retain their existing codes, categories and eligibility; compiling a file does not apply a source rewrite.
func TestSchemaWritableFieldMapping(t *testing.T) {
	source := "schema State { value:number; note?:string; nested:{ active:boolean }; readonly items:readonly number[]; locked:readonly number[] }\nconst state:State={value:1,nested:{active:false},items:[1],locked:[1]}\nstate.value=2;state.note=\"ok\";state.nested.active=true;state.locked=[3]\n"
	program, file, _, _ := editorProgram(t, source)
	for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
		if d.Category() == diagnostics.CategoryError {
			t.Errorf("writable key rejected: %s", d.String())
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
