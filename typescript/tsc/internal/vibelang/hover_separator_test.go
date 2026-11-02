package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
	"strings"
	"testing"
)

func TestHoverEndpointSeparatesContractFromBehavior(t *testing.T) {
	const source = "error EmptyName\nfunction greet(): string!EmptyName { throw new EmptyName() }\nexport function run() { return greet() }"
	_, file, service, _ := editorProgram(t, source)
	text := hoverText(t, service, lsconv.FileNameToDocumentURI(file.FileName()), lsproto.Position{Line: 2, Character: 31})
	if !strings.Contains(text, "string!EmptyName!\n\nRuns here and returns") {
		t.Fatalf("glued hover: %q", text)
	}
}
