package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

// D268 attaches the direct marker to the wrapper, including export-list aliases.
func TestD268ExportListMarker(t *testing.T) {
	files := computedKeyFiles(false)
	files["/workspace/x/src/main.vibe"] = `function double(n: number) { return n * 2 }; export { double, double as twice }`
	p := computedKeyProgram(t, files)
	var js string
	p.Emit(t.Context(), compiler.EmitOptions{WriteFile: func(name tspath.RootedFilePath, text string, _ *compiler.WriteFileData) error {
		if strings.HasSuffix(string(name), "main.js") {
			js = text
		}
		return nil
	}})
	if !strings.Contains(js, ".$direct] = double$direct") {
		t.Fatal(js)
	}
}
