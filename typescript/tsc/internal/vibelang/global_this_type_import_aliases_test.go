package vibelang

import (
	"encoding/json"
	"fmt"
	"os"
	"slices"
	"testing"
)

func TestGlobalThisTypeImportAliases(t *testing.T) {
	data, err := os.ReadFile("../vibelangfuzz/testdata/globalthis-type-import-aliases.json")
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
		for _, ext := range []string{"vibe", "vibex"} {
			t.Run(row.Key+"/"+ext, func(t *testing.T) {
				file := "main." + ext
				config := fmt.Sprintf(`{"compilerOptions":{"target":"ES2022","module":"NodeNext","moduleResolution":"NodeNext","strict":true,"skipLibCheck":true,"types":[],"lib":["ES2022","DOM"],"jsx":"preserve","noEmit":true},"vibe":{"effectGlobals":false,"effectModules":false},"files":[%q]}`, file)
				p, _, _, _ := editorProgramFile(t, file, config, row.Source, editorPackageJSON, nil)
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
}
