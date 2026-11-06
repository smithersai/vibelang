package vibelang

import (
	"encoding/json"
	"fmt"
	"os"
	"slices"
	"testing"
)

func TestGlobalThisErasedStaticAccess(t *testing.T) {
	data, err := os.ReadFile("../vibelangfuzz/testdata/globalthis-erased-static.json")
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
	for _, test := range cases {
		t.Run(test.Key, func(t *testing.T) {
			p, file, _, _ := editorProgram(t, test.Source)
			var got []string
			for _, d := range p.GetSemanticDiagnostics(t.Context(), file) {
				if d.Category() != errorCategory {
					continue
				}
				source := d.Source()
				if source == "" {
					source = "TS"
				}
				got = append(got, fmt.Sprintf("%s%04d", source, d.Code()))
			}
			slices.Sort(got)
			if !slices.Equal(got, test.Codes) {
				t.Fatalf("want %v, got %v; source=%s", test.Codes, got, test.Source)
			}
		})
	}
}
