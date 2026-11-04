package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"
)

func TestNoThrowWrappedCatchFixture(t *testing.T) {
	w := NewWorkspace(t)
	for _, c := range failuresCases() {
		if c.Name != "nothrow-wrapper-thunk-wrapped" {
			continue
		}
		if !strings.Contains(SpecText(c.chapter()), c.Quote) {
			t.Fatal("stale wrapper rule")
		}
		for _, choice := range []byte{0, 1, 2, 8} {
			t.Run(fmt.Sprint(choice), func(t *testing.T) { checkFailures(t, w, c, choice) })
		}
		return
	}
	t.Fatal("existing wrapped-handler fixture missing")
}
