package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
	"strings"
	"testing"
)

// LSP 3.17 requires each selection range to contain its child. Generated
// codec names are not source syntax and must not interrupt source selections.
func TestSchemaSelectionRangesNest(t *testing.T) {
	for _, source := range []string{
		"schema S=Array<number>",
		"schema S=Array<Record<\"x\",number>>",
		"schema S=Array<Array<number>>",
		"schema S {items:Array<number>}",
		"namespace N {export schema S=Array<Record<\"x\",number>>}",
		"schema S=ReadonlyArray<number>",
		"schema S=Readonly<Record<\"x\",number>>",
		"schema S=number[]",
		"schema S=readonly number[]",
		"type S=Array<Record<\"x\",number>>",
		"const S=Schema.mutable(Schema.Array(Schema.Number))",
	} {
		t.Run(source, func(t *testing.T) {
			_, file, service, converters := editorProgram(t, source)
			for offset := 0; offset < len(source); offset++ {
				if !strings.ContainsRune("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789", rune(source[offset])) {
					continue
				}
				pos, _ := converters.ToLSPPosition(file, core.TextPos(offset))
				response, err := service.ProvideSelectionRanges(t.Context(), &lsproto.SelectionRangeParams{
					TextDocument: lsproto.TextDocumentIdentifier{Uri: lsconv.FileNameToDocumentURI(file.FileName())},
					Positions:    []lsproto.Position{pos},
				})
				if err != nil || response.SelectionRanges == nil || len(*response.SelectionRanges) != 1 {
					t.Fatalf("selection at %d: %v %+v", offset, err, response)
				}
				for child := (*response.SelectionRanges)[0]; child.Parent != nil; child = child.Parent {
					c, p := converters.FromLSPRangeToOriginal(file, child.Range), converters.FromLSPRangeToOriginal(file, child.Parent.Range)
					if p.Pos() > c.Pos() || p.End() < c.End() {
						t.Fatalf("at byte %d child [%d,%d) outside parent [%d,%d)", offset, c.Pos(), c.End(), p.Pos(), p.End())
					}
				}
			}
		})
	}
}
