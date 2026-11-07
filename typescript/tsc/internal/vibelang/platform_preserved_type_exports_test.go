package vibelang

import (
	"encoding/json"
	"os"
	"slices"
	"testing"
)

func TestPlatformPreservedTypeExports(t *testing.T) {
	data, err := os.ReadFile("../vibelangfuzz/testdata/platform-preserved-type-exports.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases []struct {
		Key, Source string
		Verbatim    bool
		Spans       []string
	}
	if err := json.Unmarshal(data, &cases); err != nil {
		t.Fatal(err)
	}
	for _, test := range cases {
		t.Run(test.Key, func(t *testing.T) {
			p, file, _, _ := platformImportProgram(t, test.Source, test.Verbatim)
			var spans []string
			for _, d := range p.GetSemanticDiagnostics(t.Context(), file) {
				if d.Category() != errorCategory {
					continue
				}
				if d.Source() != diagnosticSource || d.Code() != 4402 {
					t.Errorf("unexpected diagnostic: %s", d.String())
					continue
				}
				spans = append(spans, test.Source[d.Pos():d.End()])
			}
			if !slices.Equal(spans, test.Spans) {
				t.Fatalf("preserved type exports retain the runtime platform boundary: want %q got %q", test.Spans, spans)
			}
		})
	}
}
