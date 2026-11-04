package vibelangfuzz

import (
	"context"
	"fmt"
	"strings"
	"testing"
)

// Campaign183: `data D { A { x : number\nnumber } ; B }` reported only
// EK1606, which the oracle did not count. The line break separates a second
// member, `number`, that is not a Field (no type). EK1606 is VIP-16's
// rejection of a malformed variant or a payload member that is not a Field,
// the data counterpart of EK2109/EK2125. Each program must report EK1606 and
// draw no mismatch; a well-formed variant list is the derived control.
func TestGrammarAdmissionDataMember(t *testing.T) {
	w := NewWorkspace(t)
	for _, c := range []struct {
		source string
		ek1606 bool
	}{
		{"data D { A { x : number\nnumber } ; B }", true},
		{"data D { A { x : number\nnumber } }", true},
		{"data D { A ( x : number ) }", true},
		{"data D { A { x : number } ; B }", false},
	} {
		t.Run(c.source, func(t *testing.T) {
			if grammarAdmissionVerdict(t, w, c.source) {
				t.Fatal("mismatch")
			}
			result, err := w.Compile(context.Background(), Single(c.source))
			if err != nil {
				t.Fatal(err)
			}
			found := false
			var seen []string
			for _, d := range result.Diagnostics {
				seen = append(seen, fmt.Sprintf("%s%d", d.Source(), d.Code()))
				found = found || IsEK(d) && d.Code() == 1606
			}
			if found != c.ek1606 {
				t.Fatalf("EK1606=%v, want %v: %s", found, c.ek1606, strings.Join(seen, ", "))
			}
		})
	}
}
