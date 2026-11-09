package vibelang

import (
	"testing"
)

// checkCatchExpressions stopped at the first catch outside effect code, so a
// later catch in the file got neither EK0504 nor EK0509 (foldkit devtools-mcp relayRegistry.vibe: readRecordFile's
// value fallback, then retireStaleRecord's link(…) catch undefined).
func TestCatchExpressionsCheckEveryCatch(t *testing.T) {
	source := "const a = (p: string): number!! => {\n  return Effect.succeed(1) catch 7\n}\nconst b = (p: string): number!! => {\n  return Effect.succeed(2) catch 8\n}\nexport effect function c() {\n  return Effect.succeed(3) catch 9\n}\n"
	program, file, _, _ := editorProgram(t, source)
	counts := map[int32]int{}
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		if d.Source() == "EK" {
			counts[d.Code()]++
		}
	}
	if counts[EK0504.Code] != 2 || counts[EK0509.Code] != 3 {
		t.Fatalf("EK0504 x%d, EK0509 x%d; want 2 and 3: every catch is checked", counts[EK0504.Code], counts[EK0509.Code])
	}
}
