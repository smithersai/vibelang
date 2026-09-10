package compiler

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
)

func TestPinnedForkComptimePropertyOrder(t *testing.T) {
	data, err := os.ReadFile("comptime-order-vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var corpus struct {
		Cases []struct{ Name, Expression, Observation, Expected string }
	}
	if err := json.Unmarshal(data, &corpus); err != nil {
		t.Fatal(err)
	}
	for _, vector := range corpus.Cases {
		t.Run(vector.Name, func(t *testing.T) {
			source := "import { comptime } from 'vibelang:comptime';\nconst value = comptime(() => " + vector.Expression + ")();\nexport function main(): string { const runtime = " + vector.Expression + "; return [" + vector.Observation + ", " + strings.ReplaceAll(vector.Observation, "value", "runtime") + "].join('|'); }"
			result := compileComptime(t, comptimeSources(source), nil)
			requireClean(t, result)
			if actual := runComptimeProgram(t, result); actual != vector.Expected+"|"+vector.Expected {
				t.Fatalf("compile/runtime mismatch: %q", actual)
			}
		})
	}
}
