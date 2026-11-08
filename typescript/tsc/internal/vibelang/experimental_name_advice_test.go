package vibelang

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
)

func TestExperimentalNameAdvice(t *testing.T) {
	data, err := os.ReadFile("../vibelangfuzz/testdata/experimental-name-advice.json")
	if err != nil {
		t.Fatal(err)
	}
	var rows []struct {
		Key, Source, Advice string
		Want                int
	}
	if err := json.Unmarshal(data, &rows); err != nil {
		t.Fatal(err)
	}
	for _, row := range rows {
		t.Run(row.Key, func(t *testing.T) {
			files := computedKeyFiles(false)
			files["/workspace/x/src/tsconfig.json"] = `{"compilerOptions":{"strict":true,"target":"ESNext","lib":["ESNext"],"module":"NodeNext","noEmit":true},"files":["main.vibe"]}`
			files["/workspace/x/src/main.vibe"] = row.Source
			count := 0
			for _, d := range computedKeyProgram(t, files).GetSemanticDiagnostics(t.Context(), nil) {
				text := diagnosticWithNotes(d)
				if strings.Contains(text, "VibeLang\u0027s experimental") {
					count++
					if !strings.Contains(text, row.Advice) {
						t.Errorf("want runnable advice %q in %s", row.Advice, text)
					}
					if strings.Contains(row.Advice, "try (try") && !strings.Contains(text, "Provide it in main with") {
						t.Errorf("missing provider: %s", text)
					}
				}
			}
			if count != row.Want {
				t.Fatalf("want %d experimental notes, got %d", row.Want, count)
			}
		})
	}
}
