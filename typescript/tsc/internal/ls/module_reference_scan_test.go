package ls_test

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

// Native references must not rescan the entire declaration source for each
// result while looking for VibeLang module-name followers.
func TestModuleReferenceScanLargeNativeLibrary(t *testing.T) {
	for _, embedded := range []bool{false, true} {
		t.Run(fmt.Sprintf("embedded-%t", embedded), func(t *testing.T) {
			measure := func(uses int) int64 {
				var library strings.Builder
				library.WriteString("export interface Item { value: number }\n")
				for i := 0; i < uses; i++ {
					fmt.Fprintf(&library, "export type Use%d = Item;\n", i)
				}
				source := "import type { Item } from './library.js';\nexport type Result = Item;\n"
				extra := map[string]string{"/project/library.ts": library.String()}
				if embedded {
					source = "module local { export const n = 1 }\n" + library.String()
					extra = nil
				}
				service, p, converters := moduleEditorServiceFiles(t, source, extra)
				file := p.GetSourceFile("/project/main.vibe")
				uri := lsconv.FileNameToDocumentURI(file.FileName())
				position, _ := converters.ToLSPPosition(file, core.TextPos(strings.LastIndex(source, "Item")))
				result := testing.Benchmark(func(b *testing.B) {
					for b.Loop() {
						response, err := service.ProvideReferences(t.Context(), &lsproto.ReferenceParams{
							TextDocument: lsproto.TextDocumentIdentifier{Uri: uri}, Position: position,
							Context: &lsproto.ReferenceContext{IncludeDeclaration: true},
						}, nil)
						if err != nil {
							b.Fatal(err)
						}
						if response.Locations == nil || len(*response.Locations) < uses {
							b.Fatalf("reference answer lost native occurrences: %v", response)
						}
					}
				})
				return result.NsPerOp()
			}
			// Eight times as many references used to cause 64 times as many
			// postprocessing visits. Compare steady-state queries on the same host.
			small, large := measure(3750), measure(30000)
			if small == 0 || large > 32*small {
				t.Fatalf("8x as many references took %d vs %d ns per query", large, small)
			}
		})
	}
}
