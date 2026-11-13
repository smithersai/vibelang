package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/astnav"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

// Lowering a default does not change the identity of the written source read.
// Both references and rename must reach it from either occurrence.
func TestEditorDoBindingSourceReferences(t *testing.T) {
	for _, pattern := range []struct{ name, binding, input string }{
		{"array-match", "[value = match (true) { default: do { return 9 }; }]", "Iterable<number | undefined>"},
		{"array-do", "[value = do { return 9 }]", "Iterable<number | undefined>"},
		{"object-match", "{value = match (true) { default: do { return 9 }; }}", "{ value?: number }"},
	} {
		for _, name := range []string{"source", "type", "from", "satisfies", "caféSource"} {
			for _, origin := range []string{"declaration", "declaration-end", "use", "use-end"} {
				t.Run(pattern.name+"/"+name+"/"+origin, func(t *testing.T) {
					source := "export function pick(" + name + ": " + pattern.input + "): string {\n  const " + pattern.binding + " = " + name + "\n  return \"done\"\n}\n"
					_, file, service, converters := editorProgram(t, source)
					offset := strings.Index(source, name+":")
					if strings.HasPrefix(origin, "use") {
						offset = strings.LastIndex(source, name)
					}
					if strings.HasSuffix(origin, "-end") {
						offset += len(name)
					}
					pos, _ := converters.ToLSPPosition(file, core.TextPos(offset))
					uri := lsconv.FileNameToDocumentURI(file.FileName())
					refs, err := service.ProvideReferences(t.Context(), &lsproto.ReferenceParams{
						TextDocument: lsproto.TextDocumentIdentifier{Uri: uri},
						Position:     pos,
						Context:      &lsproto.ReferenceContext{IncludeDeclaration: true},
					}, nil)
					if err != nil || refs.Locations == nil || len(*refs.Locations) != 2 {
						node := astnav.GetTokenAtPosition(file, offset)
						t.Logf("source lookup: kind=%v range=[%d,%d)", node.Kind, node.Pos(), node.End())
						t.Fatalf("references at byte %d: %v %v; want declaration and use", offset, refs, err)
					}
					rename, err := service.ProvideRename(t.Context(), &lsproto.RenameParams{
						TextDocument: lsproto.TextDocumentIdentifier{Uri: uri},
						Position:     pos,
						NewName:      "renamedSource",
					}, nil)
					if err != nil || rename.WorkspaceEdit == nil || rename.WorkspaceEdit.Changes == nil {
						t.Fatalf("rename: %v %v", rename, err)
					}
					after := applyEditorEdits(t, file, converters, (*rename.WorkspaceEdit.Changes)[uri])
					if after != strings.ReplaceAll(source, name, "renamedSource") {
						t.Fatalf("rename missed a written occurrence:\n%s", after)
					}
				})
			}
		}
	}
}
