package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

// A skipped initializer changes definite assignment, not the source binding's
// identity. References and rename work from either its declaration or its use.
func TestEditorLoopPatternBindingReferences(t *testing.T) {
	for _, row := range []struct{ name, body string }{
		{"while", "while(true||(1 is const boundValue)){return boundValue}"},
		{"for-empty", "for(;true||(1 is const boundValue);){return boundValue}"},
		{"for-let", "for(let n=0;true||(1 is const boundValue);n++){return boundValue}"},
		{"for-const", "for(const n=0;true||(1 is const boundValue);){return boundValue}"},
		{"for-expression", "let n=0;for(n=1;true||(1 is const boundValue);n++){return boundValue}"},
		{"for-update", "for(let n=0;n<2;true||(1 is const boundValue)){return boundValue}"},
		{"do", "do{return boundValue}while(true||(1 is const boundValue))"},
		{"reached-control", "while(1 is const boundValue){return boundValue}"},
		{"if-control", "if(true||(1 is const boundValue)){return boundValue}"},
	} {
		for _, origin := range []string{"declaration", "use"} {
			t.Run(row.name+"/"+origin, func(t *testing.T) {
				source := "export function f():unknown {" + row.body + "}"
				_, file, service, converters := editorProgram(t, source)
				offset := strings.Index(source, "const boundValue") + len("const ")
				if origin == "use" {
					offset = strings.Index(source, "return boundValue") + len("return ")
				}
				pos, _ := converters.ToLSPPosition(file, core.TextPos(offset))
				uri := lsconv.FileNameToDocumentURI(file.FileName())
				references, err := service.ProvideReferences(t.Context(), &lsproto.ReferenceParams{
					TextDocument: lsproto.TextDocumentIdentifier{Uri: uri},
					Position:     pos,
					Context:      &lsproto.ReferenceContext{IncludeDeclaration: true},
				}, nil)
				if err != nil || references.Locations == nil || len(*references.Locations) != 2 {
					t.Fatalf("references must include declaration and use: %v %v", references, err)
				}
				locations := map[uint32]bool{}
				for _, location := range *references.Locations {
					if location.Uri != uri || location.Range.Start.Line != 0 || location.Range.End.Character-location.Range.Start.Character != uint32(len("boundValue")) {
						t.Fatalf("reference escaped its source name: %+v", location)
					}
					locations[location.Range.Start.Character] = true
				}
				for _, needle := range []string{"const boundValue", "return boundValue"} {
					start := strings.Index(source, needle) + strings.Index(needle, "boundValue")
					if !locations[uint32(start)] {
						t.Fatalf("missing source reference at %d: %v", start, locations)
					}
				}
				rename, err := service.ProvideRename(t.Context(), &lsproto.RenameParams{
					TextDocument: lsproto.TextDocumentIdentifier{Uri: uri},
					Position:     pos,
					NewName:      "renamedValue",
				}, nil)
				if err != nil || rename.WorkspaceEdit == nil || rename.WorkspaceEdit.Changes == nil {
					t.Fatalf("rename: %v %v", rename, err)
				}
				after := applyEditorEdits(t, file, converters, (*rename.WorkspaceEdit.Changes)[uri])
				if after != strings.ReplaceAll(source, "boundValue", "renamedValue") {
					t.Fatalf("rename must edit the declaration and its use:\n%s", after)
				}
			})
		}
	}
}
