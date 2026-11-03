package vibelang

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
)

func TestErrorEditorSignatureSpan(t *testing.T) {
	for _, source := range []string{
		`error E { a: string }`,
		"error E {\n  // field\n  a: string\n  b: number\n}",
		"error E { /* before */ a: string; b?: number }",
		`error E<T> { value:T }`,
		`schema error E { a:string }`,
	} {
		t.Run(source, func(t *testing.T) {
			defer func() {
				if failure := recover(); failure != nil {
					t.Errorf("editor request panicked: %v", failure)
				}
			}()
			_, file, service, converters := editorProgram(t, source)
			uri := lsconv.FileNameToDocumentURI(file.FileName())
			for offset := 0; offset <= len(source); offset++ {
				pos, _ := converters.ToLSPPosition(file, core.TextPos(offset))
				if _, err := service.ProvideSignatureHelp(t.Context(), uri, pos, nil); err != nil {
					t.Fatalf("byte %d: %v", offset, err)
				}
			}
		})
	}
}
