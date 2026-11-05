package ls_test

import (
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

// Native references must not rescan the entire declaration source for each
// result while looking for VibeLang module-name followers.
func TestModuleReferenceScanLargeNativeLibrary(t *testing.T) {
	for _, embedded := range []bool{false, true} {
		t.Run(fmt.Sprintf("embedded-%t", embedded), func(t *testing.T) {
			const uses = 30000
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
			started := time.Now()
			response, err := service.ProvideReferences(t.Context(), &lsproto.ReferenceParams{
				TextDocument: lsproto.TextDocumentIdentifier{Uri: uri}, Position: position,
				Context: &lsproto.ReferenceContext{IncludeDeclaration: true},
			}, nil)
			elapsed := time.Since(started)
			t.Logf("references: libraryBytes=%d uses=%d elapsed=%s", library.Len(), uses, elapsed)
			if err != nil {
				t.Fatal(err)
			}
			if response.Locations == nil || len(*response.Locations) < uses {
				t.Fatalf("reference answer lost native occurrences: %v", response)
			}
			// This allows ample time for the native reference search; the regression
			// performed billions of unrelated AST visits after it had the answer.
			if elapsed > 10*time.Second {
				t.Fatalf("native library references took %s; expected bounded postprocessing", elapsed)
			}
		})
	}
}
