package vibelangfuzz

import (
	"strings"
	"testing"
)

func TestOptionHandlerFieldCountsQuoted(t *testing.T) { TestOptionMatchFixQuoted(t) }

// Do not let a missing Effect dependency or an already-invalid input turn the
// editor regression into a no-op. Every retained shape must compile and reach
// the actual EK4839 diagnostic before FuzzEditor applies its code action.
func TestOptionHandlerFieldCountControls(t *testing.T) {
	TestOptionHandlerFieldCountsQuoted(t)
	w := NewWorkspace(t)
	count := 0
	for _, args := range CorpusInputs("FuzzEditor") {
		if len(args) == 0 || !strings.Contains(args[0], "// t3code-option-handler-fields:") {
			continue
		}
		count++
		files := toolsUnarchive(args[0])
		result := toolsCompile(t, w, "FuzzEditor", files)
		if !toolsErrorFree(result) {
			result.Remove()
			t.Fatalf("qualified Option control must compile: %v", SortedKeys(Keys(result.Dir, result.Diagnostics)))
		}
		found := false
		for _, d := range result.Diagnostics {
			if IsEK(d) && d.Code() == 4839 {
				found = true
			}
		}
		result.Remove()
		if !found {
			t.Fatalf("retained payload never reached EK4839:\n%s", args[0])
		}
	}
	if count != 7 {
		t.Fatalf("want7field-count controls, got%d", count)
	}
}
