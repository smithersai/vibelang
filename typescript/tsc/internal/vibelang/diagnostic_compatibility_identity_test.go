package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"strings"
	"testing"
)

func TestCompatibilityIdentityPrimaryMessages(t *testing.T) {
	for _, tc := range []struct {
		code     int32
		category diagnostics.Category
		meaning  string
	}{
		{2005, errorCategory, "for try"},
		{9100, warningCategory, "{0}"},
		{9101, diagnostics.CategorySuggestion, "{0}"},
		{2104, errorCategory, "yield"},
		{3007, errorCategory, "configuration"},
		{3201, errorCategory, "resolved effect"},
		{9209, errorCategory, "setup statements"},
		{9210, errorCategory, "resumeWith"},
		{9211, errorCategory, "Nothing provides"},
		{9212, errorCategory, "already declares"},
		{9213, warningCategory, "value binding"},
		{9214, errorCategory, "service key"},
	} {
		m := registry[tc.code]
		if m == nil || m.Category != tc.category || !strings.Contains(m.Text, tc.meaning) {
			t.Fatalf("EK%d: %+v; want %v %s", tc.code, m, tc.category, tc.meaning)
		}
	}
	if registry[4408] != nil {
		t.Fatal("retired shared EK4408 remains registered")
	}
}
