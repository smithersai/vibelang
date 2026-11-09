package vibelang

import (
	"encoding/json"
	"fmt"
	"os"
	"slices"
	"testing"
)

func TestGlobalThisImportAliases(t *testing.T) {
	data, err := os.ReadFile("../vibelangfuzz/testdata/globalthis-import-aliases.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases []struct {
		Key, Source string
		Codes       []string
	}
	if err = json.Unmarshal(data, &cases); err != nil {
		t.Fatal(err)
	}
	for _, row := range cases {
		t.Run(row.Key, func(t *testing.T) {
			p, _, _, _ := editorProgram(t, row.Source)
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
			slices.Sort(codes)
			if !slices.Equal(codes, row.Codes) {
				t.Fatalf("want %v, got %v; source=%s", row.Codes, codes, row.Source)
			}
		})
	}
}
