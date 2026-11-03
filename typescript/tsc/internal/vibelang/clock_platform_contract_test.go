package vibelang

import (
	"encoding/json"
	"os"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestClockPlatformContract(t *testing.T) {
	var rows []struct {
		Key, Source, Severity string
		Banned                bool
	}
	data, err := os.ReadFile("../vibelangfuzz/testdata/clock-platform-contract.json")
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(data, &rows); err != nil {
		t.Fatal(err)
	}
	for _, row := range rows {
		t.Run(row.Key, func(t *testing.T) {
			files := computedKeyFiles(false)
			files["/workspace/x/src/main.vibe"] = row.Source
			if row.Severity != "default" {
				severity := strings.TrimPrefix(row.Severity, "legacy-")
				config := files["/workspace/x/src/tsconfig.json"]
				files["/workspace/x/src/tsconfig.json"] = strings.TrimSuffix(config, "}") + `,"vibelang":{"diagnostics":{"EK4403":"` + severity + `"}}}`
			}
			p := computedKeyProgram(t, files)
			banned := false
			for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), nil), p.GetSemanticDiagnostics(t.Context(), nil)...) {
				if d.Code() == 4403 {
					t.Errorf("retired EK4403 emitted: %s", d.MessageText())
				}
				if d.Code() == 4402 && d.Category() == diagnostics.CategoryError {
					banned = true
					continue
				}
				if !row.Banned && d.Category() == diagnostics.CategoryError {
					t.Errorf("control error %d: %s", d.Code(), d.MessageText())
				}
			}
			if banned != row.Banned {
				t.Errorf("want platform error=%v; got %v", row.Banned, banned)
			}
		})
	}
}
