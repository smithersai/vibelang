package vibelang

import (
	"encoding/json"
	"os"
	"slices"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestForTryClassHeadJumps(t *testing.T) {
	data, err := os.ReadFile("testdata/for_try_class_head_jumps.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases []struct {
		Key, Source string
		Want        []int32
	}
	if err := json.Unmarshal(data, &cases); err != nil {
		t.Fatal(err)
	}
	for _, test := range cases {
		t.Run(test.Key, func(t *testing.T) {
			p, file, _, _ := editorProgram(t, test.Source)
			all := append(p.GetSyntacticDiagnostics(t.Context(), file), p.GetSemanticDiagnostics(t.Context(), file)...)
			var got []int32
			for _, d := range all {
				if d.Category() == diagnostics.CategoryError {
					got = append(got, d.Code())
				}
			}
			slices.Sort(got)
			slices.Sort(test.Want)
			if !slices.Equal(got, test.Want) {
				t.Errorf("want %v, got %v in %s", test.Want, got, test.Source)
			}
		})
	}
}

func TestForTryClassHeadLocalJumps(t *testing.T) {
	for _, source := range []string{
		"effect function f(){for try(const item of Stream.make(1)){class C { [do { local:{break local}; \"m\" }](){} }}}",
		"effect function f(){for try(const item of Stream.make(1)){class C { [do { for(let i=0;i<1;i++){continue}; \"m\" }](){} }}}",
		"effect function f(){for try(const item of Stream.make(1)){class C { m(){return 1} }}}",
	} {
		if errors := errorsOf(t, source); len(errors) != 0 {
			t.Fatalf("local source context: %v in %s", errors, source)
		}
	}
}
