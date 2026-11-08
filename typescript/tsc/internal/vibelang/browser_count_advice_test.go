package vibelang

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
)

func TestBrowserCountAdvice(t *testing.T) {
	var rows []struct {
		Key, Source string
		Host        bool
	}
	data, err := os.ReadFile("../vibelangfuzz/testdata/browser-count-advice.json")
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
				for _, want := range []string{"read navigator.hardwareConcurrency in a .ts adapter", "not provided by the browser layer"} {
					if !strings.Contains(text, want) {
						t.Errorf("missing %q in:\n%s", want, text)
					}
				}
				if strings.Contains(text, "Provide it in main with ExperimentalNodeServices") {
					t.Errorf("browser advice selects Node services:\n%s", text)
				}
			}
			if row.Host != (count > 0) {
				t.Fatalf("want host diagnostic %t,got %d", row.Host, count)
			}
		})
	}
}
