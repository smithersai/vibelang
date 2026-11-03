package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

func TestServiceNamespaceRename(t *testing.T) {
	source := `service Settings { static readonly key="tests/Settings"; prefix:string; static readonly defaultValue=():Settings.Shape=>({prefix:"x"}) }
 export function label(x:Settings.Shape){return x.prefix}
 export const key=Settings`
	for _, offset := range []int{strings.Index(source, "Settings"), strings.Index(source, "Settings.Shape"), strings.LastIndex(source, "Settings")} {
		t.Run(strings.Repeat("x", offset%7+1), func(t *testing.T) {
			_, file, service, converters := editorProgram(t, source)
			uri := lsconv.FileNameToDocumentURI(file.FileName())
			pos, _ := converters.ToLSPPosition(file, core.TextPos(offset))
			response, err := service.ProvideRename(t.Context(), &lsproto.RenameParams{TextDocument: lsproto.TextDocumentIdentifier{Uri: uri}, Position: pos, NewName: "Preferences"}, nil)
			if err != nil || response.WorkspaceEdit == nil || response.WorkspaceEdit.Changes == nil {
				t.Fatalf("rename: %v %v", response, err)
			}
			after := applyEditorEdits(t, file, converters, (*response.WorkspaceEdit.Changes)[uri])
			if strings.Count(after, "Preferences") != 4 {
				t.Fatalf("missing service reference: %s", after)
			}
			if !strings.Contains(after, `"tests/Settings"`) {
				t.Fatal("rename changed the explicit runtime key")
			}
			p, f, _, _ := editorProgram(t, after)
			for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), f), p.GetSemanticDiagnostics(t.Context(), f)...) {
				if d.Category() == diagnostics.CategoryError {
					t.Errorf("renamed diagnostic: %s", d.String())
				}
			}
		})
	}
}
