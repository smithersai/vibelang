package vibelang

import (
	"slices"
	"testing"
)

// An explicit effect function* remains a producer when passed to any-typed
// code or a parameter that is not a generator (VIP-21).
func TestProducerReturnResolvedCalleeStillReports(t *testing.T) {
	for _, source := range []string{
		"declare const take: any\nexport const load = take(effect function* () {\n  return 1\n})\n",
		"declare function take(f: unknown): void\ntake(effect function* () {\n  return 1\n})\n",
	} {
		program, file, _, _ := editorProgramWith(t, source, map[string]string{})
		var codes []int32
		for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
			codes = append(codes, d.Code())
		}
		if !slices.Contains(codes, EK2128.Code) {
			t.Fatalf("codes %v; want EK2128 for\n%s", codes, source)
		}
	}
}
