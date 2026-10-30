package vibelangfuzz

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/vibelangfuzz/vipgen"
)

func TestDataChapterWitnessesQuoted(t *testing.T) {
	for _, w := range vipgen.ChapterWitnesses() {
		if !strings.Contains(SpecText(w.Chapter), w.Quote) {
			t.Errorf("%s: chapter %s no longer says %q", w.Key, w.Chapter, w.Quote)
		}
	}
}
