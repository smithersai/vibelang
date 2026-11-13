package vibelang

import (
	"encoding/json"
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"os"
	"slices"
	"testing"
)

func TestRejectedConstructorFieldHeaders(t *testing.T) {
	data, err := os.ReadFile("../vibelangfuzz/testdata/rejected-constructor-field-headers.json")
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
	for _, tc := range cases {
		t.Run(tc.Key, func(t *testing.T) {
			p, file, _, _ := editorProgram(t, tc.Source)
			var got []string
			for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), file), p.GetSemanticDiagnostics(t.Context(), file)...) {
				if d.Category() != diagnostics.CategoryError {
					continue
				}
				source := d.Source()
				if source == "" {
					source = "TS"
				}
				got = append(got, fmt.Sprintf("%s%04d", source, d.Code()))
			}
			slices.Sort(got)
			if !slices.Equal(got, tc.Codes) {
				t.Fatalf("want %v, got %v; source: %s", tc.Codes, got, tc.Source)
			}
		})
	}
}
