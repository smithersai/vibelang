package vibelangfuzz

import (
	"fmt"
	"testing"
)

// A trivia mutation must keep off-by-default diagnostics enabled. Putting an
// inline block comment before a file directive silently disabled these sites.
func TestQuickFixWarningTriviaKeepsTriggers(t *testing.T) {
	w := NewWorkspace(t)
	generators := quickfixBehaviorSeeds()
	for _, code := range []int32{4817, 4821} {
		for _, choices := range [][]byte{{0}, {3, 1}} {
			t.Run(fmt.Sprintf("EK%d/%v", code, choices), func(t *testing.T) {
				key := fmt.Sprintf("EK%04d@%s", code, generators[code][0].Name)
				files, _, _ := quickfixBehaviorProgram(generators, key, choices)
				r := toolsCompile(t, w, quickfixBehaviorTarget, files)
				defer r.Remove()
				if !toolsErrorFree(r) {
					t.Fatalf("warning fixture is not admitted: %v", SortedKeys(Keys(r.Dir, r.Diagnostics)))
				}
				for _, d := range r.Diagnostics {
					if IsEK(d) && d.Code() == code {
						return
					}
				}
				t.Fatalf("trivia removed EK%d: %s", code, Archive(files))
			})
		}
	}
}
