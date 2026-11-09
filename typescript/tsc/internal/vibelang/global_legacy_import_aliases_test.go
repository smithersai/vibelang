package vibelang

import (
	"encoding/json"
	"fmt"
	"os"
	"slices"
	"testing"
)

func TestGlobalLegacyImportAliases(t *testing.T) {
	data, err := os.ReadFile("../vibelangfuzz/testdata/global-legacy-import-aliases.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases []struct {
		Key, Source string
		Want        int
	}
	if err = json.Unmarshal(data, &cases); err != nil {
		t.Fatal(err)
	}
	for _, row := range cases {
		for _, ext := range []string{"vibe", "vibex"} {
			t.Run(row.Key+"/"+ext, func(t *testing.T) {
				p, _, _, _ := editorProgramAt(t, "main."+ext, `{"target":"ES2022","module":"NodeNext","moduleResolution":"NodeNext","strict":true,"skipLibCheck":true,"types":[],"lib":["ES2022","DOM"],"jsx":"preserve"}`, row.Source, editorPackageJSON, editorPackages)
				var codes []string
				for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), nil), p.GetSemanticDiagnostics(t.Context(), nil)...) {
					if d.Category() != errorCategory {
						continue
					}
					prefix := d.Source()
					if prefix == "" {
						prefix = "TS"
					}
					codes = append(codes, fmt.Sprintf("%s%04d", prefix, d.Code()))
				}
				var want []string
				for range row.Want {
					want = append(want, "EK0107")
				}
				if !slices.Equal(codes, want) {
					t.Fatalf("want %v, got %v; source=%s", want, codes, row.Source)
				}
			})
		}
	}
}
