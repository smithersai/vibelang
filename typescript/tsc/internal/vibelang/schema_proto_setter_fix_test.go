package vibelang

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

func TestSchemaPrototypeSetterHasNoLossyRewrite(t *testing.T) {
	keys := []string{"__proto__", `"__proto__"`, `'__proto__'`, `"__pro\u0074o__"`, `__pro\u0074o__`}
	for i, key := range keys {
		field := key + ": Schema.String"
		for _, test := range []struct {
			name, source string
			code         int32
		}{
			{"struct", "export const Proto = Schema.Struct({ " + field + " })", 4832},
			{"nested", "export const Proto = Schema.Struct({ value: Schema.Struct({ " + field + " }) })", 4832},
			{"schema-error", "export class Proto extends Schema.TaggedError<Proto>()(\"Proto\", { " + field + " }) {}", 4837},
		} {
			t.Run(fmt.Sprintf("key%d/%s", i, test.name), func(t *testing.T) {
				program, file, service, converters := editorProgram(t, test.source)
				for _, diagnostic := range program.GetSemanticDiagnostics(t.Context(), file) {
					if diagnostic.Category() == diagnostics.CategoryError {
						t.Fatalf("native control must typecheck: %s", diagnostic.String())
					}
					if diagnostic.Source() != diagnosticSource || diagnostic.Code() != test.code {
						continue
					}
					d := lsconv.DiagnosticToLSPPush(t.Context(), converters, diagnostic)
					only := []lsproto.CodeActionKind{lsproto.CodeActionKindQuickFix}
					response, err := service.ProvideCodeActions(t.Context(), &lsproto.CodeActionParams{
						TextDocument: lsproto.TextDocumentIdentifier{Uri: lsconv.FileNameToDocumentURI(file.FileName())},
						Range:        d.Range, Context: &lsproto.CodeActionContext{Diagnostics: []*lsproto.Diagnostic{d}, Only: &only},
					})
					if err != nil {
						t.Fatal(err)
					}
					if response.CommandOrCodeActionArray == nil {
						continue
					}
					for _, action := range *response.CommandOrCodeActionArray {
						if action.CodeAction != nil && strings.HasPrefix(action.CodeAction.Title, "Write schema ") && action.CodeAction.Edit != nil {
							t.Fatalf("a native prototype setter must not become an own schema field: %s", action.CodeAction.Title)
						}
					}
				}
			})
		}
	}
}

func TestSchemaPrototypeSetterLeavesOrdinaryFieldRepairs(t *testing.T) {
	for _, key := range []string{"id", `"prototype"`, `"constructor"`} {
		t.Run(key, func(t *testing.T) {
			source := "export const Proto = Schema.Struct({ " + key + ": Schema.String })"
			fixed := applyQuickFixOf(t, source, 4832, diagnostics.CategoryWarning)
			program, file, _, _ := editorProgram(t, fixed)
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Category() == diagnostics.CategoryError {
					t.Fatalf("ordinary field repair is invalid: %s", d.String())
				}
			}
		})
	}
}
