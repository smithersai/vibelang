package vibelangfuzz

import (
	"fmt"
	"testing"
)

func TestCatchMissingArrowKeepsNativeTypeErrors(t *testing.T) {
	w := NewWorkspace(t)
	for _, head := range []string{"(e)", "effect (e)", "async (e)"} {
		t.Run(head, func(t *testing.T) {
			source := "import { Effect } from \"effect\"; export effect function f() { return Effect.fail(\"bad\") catch " + head + " { const bad: number = \"wrong\"; return 0 } }"
			r, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source}})
			if err != nil {
				t.Fatal(err)
			}
			defer r.Remove()
			handler, native := 0, 0
			var codes []string
			for _, d := range r.Diagnostics {
				codes = append(codes, fmt.Sprintf("%s%d", d.Source(), d.Code()))
				if IsEK(d) && d.Code() == 509 {
					handler++
				}
				if !IsEK(d) && d.Code() == 2322 {
					native++
				}
				if !IsEK(d) && d.Code() == 2345 {
					t.Errorf("provisional handler argument mismatch was not suppressed: %v", d)
				}
			}
			if handler != 1 || native != 1 {
				t.Fatalf("want one EK0509 and independent TS2322, got %v", codes)
			}
		})
	}
}
