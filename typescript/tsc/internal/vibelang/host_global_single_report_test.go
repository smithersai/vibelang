package vibelang

import (
	"strings"
	"testing"
)

// A banned member read through a listed host global reports EK4402 once: the
// listed global's advice covers the chain, and the derived ban adds nothing.
// A chain rooted at globalThis alone still gets the derived ban's report.
func TestHostGlobalMemberReportedOnce(t *testing.T) {
	rows := []struct{ name, source, text string }{
		{"window member", "export const read = window.KeyboardEvent\n", "is platform code"},
		{"globalThis window chain", "export const read = globalThis.window.KeyboardEvent\n", "is platform code"},
		{"literal keys", `export const read = globalThis["window"]["KeyboardEvent"]` + "\n", "is platform code"},
		{"constructed", `export const read = new window.KeyboardEvent("keydown")` + "\n", "is platform code"},
		{"self member", "export const read = self.WheelEvent\n", "is platform code"},
		{"repeated globalThis", "export const read = globalThis.globalThis.window.KeyboardEvent\n", "is platform code"},
		{"globalThis member", "export const read = globalThis.KeyboardEvent\n", "reads a host global"},
		{"globalThis literal key", `export const read = globalThis["WheelEvent"]` + "\n", "reads a host global"},
		{"bare constructor", "export const read = KeyboardEvent\n", "reads a host global"},
	}
	for _, row := range rows {
		t.Run(row.name, func(t *testing.T) {
			files := computedKeyFiles(false)
			files["/workspace/x/src/main.vibe"] = row.source
			var reports []string
			for _, d := range computedKeyProgram(t, files).GetSemanticDiagnostics(t.Context(), nil) {
				if d.Code() == EK4402.Code {
					reports = append(reports, d.String())
				}
			}
			if len(reports) != 1 || !strings.Contains(reports[0], row.text) {
				t.Fatalf("want one EK4402 saying %q, got %d:\n%s\nsource:\n%s", row.text, len(reports), strings.Join(reports, "\n"), row.source)
			}
		})
	}
}
