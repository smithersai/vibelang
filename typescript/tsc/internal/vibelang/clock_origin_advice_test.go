package vibelang

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
)

func TestClockOriginAdvice(t *testing.T) {
	var rows []struct {
		Key, Source string
		Host        bool
	}
	data, err := os.ReadFile("../vibelangfuzz/testdata/clock-origin-advice.json")
	if err != nil {
		t.Fatal(err)
	}
	if err = json.Unmarshal(data, &rows); err != nil {
		t.Fatal(err)
	}
	for _, row := range rows {
		t.Run(row.Key, func(t *testing.T) {
			files := computedKeyFiles(false)
			files["/workspace/x/src/main.vibe"] = row.Source
			count := 0
			for _, d := range computedKeyProgram(t, files).GetSemanticDiagnostics(t.Context(), nil) {
				if d.Code() != EK4402.Code {
					continue
				}
				count++
				text := diagnosticWithNotes(d)
				for _, want := range []string{
					"Number((try Clock.monotonicTimeNanos) - startNanos) / 1e6",
					"arbitrary origin", "same clock", "native origin", ".ts adapter",
				} {
					if !strings.Contains(text, want) {
						t.Errorf("missing %q in:\n%s", want, text)
					}
				}
			}
			if row.Host != (count > 0) {
				t.Fatalf("want host diagnostic presence %t, got %d", row.Host, count)
			}
		})
	}
}
