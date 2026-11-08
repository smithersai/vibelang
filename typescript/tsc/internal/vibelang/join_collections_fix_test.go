package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

// The editor describes the same single-Fiber operation as VIP-17.
func TestLegacyCollectionJoinHover(t *testing.T) {
	const source = "export effect function main(f: Fiber.Fiber<number,string>) { return join f }"
	_, file, service, _ := editorProgram(t, source)
	pos := strings.Index(source, "join f")
	text := hoverText(t, service, lsconv.FileNameToDocumentURI(file.FileName()), lsproto.Position{Line: 0, Character: uint32(pos)})
	if !strings.Contains(text, "Fiber.join") || !strings.Contains(text, "propagates its failure") {
		t.Fatalf("missing native join behavior: %s", text)
	}
	for _, retired := range []string{"every fiber of the array", "failure interrupts the rest"} {
		if strings.Contains(text, retired) {
			t.Fatalf("retired collection promise: %s", text)
		}
	}
}
