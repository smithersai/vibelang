package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

func TestPredicateParameterReferences(t *testing.T) {
	for _, op := range []string{"is", "instanceof"} {
		for _, name := range []string{"e", "renamedParameter", "café"} {
			source := "error E\nexport function pick(){return (" + name + ":unknown)=>" + name + " " + op + " E}"
			t.Run(op+"/"+name, func(t *testing.T) {
				_, file, service, converters := editorProgram(t, source)
				uri := lsconv.FileNameToDocumentURI(file.FileName())
				for _, offset := range []int{strings.Index(source, name+":unknown"), strings.LastIndex(source, name+" "+op)} {
					pos, _ := converters.ToLSPPosition(file, core.TextPos(offset))
					refs, err := service.ProvideReferences(t.Context(), &lsproto.ReferenceParams{TextDocument: lsproto.TextDocumentIdentifier{Uri: uri}, Position: pos, Context: &lsproto.ReferenceContext{IncludeDeclaration: true}}, nil)
					if err != nil {
						t.Fatal(err)
					}
					if refs.Locations == nil || len(*refs.Locations) != 2 {
						t.Fatalf("references at byte %d: %v, want declaration and use", offset, refs)
					}
					response, err := service.ProvideRename(t.Context(), &lsproto.RenameParams{TextDocument: lsproto.TextDocumentIdentifier{Uri: uri}, Position: pos, NewName: "freshParameter"}, nil)
					if err != nil || response.WorkspaceEdit == nil || response.WorkspaceEdit.Changes == nil {
						t.Fatalf("rename: %v %v", response, err)
					}
					after := applyEditorEdits(t, file, converters, (*response.WorkspaceEdit.Changes)[uri])
					if strings.Count(after, "freshParameter") != 2 {
						t.Fatalf("rename missed occurrence: %s", after)
					}
				}
			})
		}
	}
}
