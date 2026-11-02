package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

// A using supplies Scope to its whole initializer, so a function whose using
// initializer has a generic R shows Exclude<R, Scope> as its R, as Chapter
// 14 writes it (D490): before, the editor showed R, and a caller that passed
// a scoped acquisition needed Scope.
func TestHoverShowsGenericUsingRequirementWithoutScope(t *testing.T) {
	t.Parallel()
	const source = "export function withResource<A extends Disposable, R>(open: () => A!!R) {\n  using r = open()\n  return \"used\"\n}\n"
	_, file, service, _ := editorProgram(t, source)
	text := hoverText(t, service, lsconv.FileNameToDocumentURI(file.FileName()), lsproto.Position{Line: 0, Character: 17})
	if !strings.Contains(text, "Exclude<R, Scope>") {
		t.Fatalf("hover of withResource does not show Exclude<R, Scope>:\n%s", text)
	}
}
