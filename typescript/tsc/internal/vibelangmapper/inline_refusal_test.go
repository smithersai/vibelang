package vibelangmapper

import "testing"

func TestInlineModuleRefusalIsFormChoice(t *testing.T) {
	source := `module text { export const result = 1 }; import { result } from text; export const answer = result`
	p := Project(source, testContext)
	if len(p.Diagnostics) == 0 {
		t.Fatal("missing inline module refusal")
	}
	for _, d := range p.Diagnostics {
		if d.Code != CodeFormChoice {
			t.Fatalf("wanted EK9005, got %v", p.Diagnostics)
		}
	}
	assertValidMap(t, p, source)
}
