package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"strings"
	"testing"
)

// These reporters remain registered. Their old compiler inputs no longer reach
// them. This checks allocation only; exact test.todo witnesses track emission.
func TestAppendixRegisteredOnlyHostExamples(t *testing.T) {
	for _, tc := range []struct {
		code     int32
		category diagnostics.Category
		meaning  string
	}{
		{1013, errorCategory, "separated by"},
		{2107, errorCategory, "not a control"},
		{2108, errorCategory, "has no clause"},
		{2110, errorCategory, "resume returns"},
		{2119, errorCategory, "This clause returns"},
		{4201, errorCategory, "control operation"},
		{4202, errorCategory, "TypeScript function"},
		{4406, warningCategory, "will not survive"},
	} {
		m := registry[tc.code]
		if m == nil || m.Category != tc.category || !strings.Contains(m.Text, tc.meaning) {
			t.Fatalf("EK%d: %+v; want %v / %s", tc.code, m, tc.category, tc.meaning)
		}
	}
}
