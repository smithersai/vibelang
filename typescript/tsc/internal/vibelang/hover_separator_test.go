package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
	"strings"
	"testing"
)

func TestHoverEndpointSeparatesContractFromBehavior(t *testing.T) {
	const source = "error EmptyName\neffect function greet(): string!EmptyName { throw new EmptyName() }\nexport effect function run() { return try greet() }"
	_, file, service, _ := editorProgram(t, source)
	text := hoverText(t, service, lsconv.FileNameToDocumentURI(file.FileName()), lsproto.Position{Line: 2, Character: 42})
	if !strings.Contains(text, "string!EmptyName!\n\nRuns here and returns") {
		t.Fatalf("glued hover: %q", text)
	}
}
