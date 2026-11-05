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
		{3501, errorCategory, "Handlers"},
		{9211, errorCategory, "Nothing provides"},
		{9214, errorCategory, "service key"},
	} {
		m := registry[tc.code]
		if m == nil || m.Category != tc.category || !strings.Contains(m.Text, tc.meaning) {
			t.Fatalf("EK%d: %+v; want %v %s", tc.code, m, tc.category, tc.meaning)
		}
	}
	if registry[9210] != nil {
		t.Fatal("retired continuation contract identity remains registered; first-release forms use EK3501")
	}
	if registry[4408] != nil {
		t.Fatal("retired shared EK4408 remains registered")
	}
	// VIP-40: a duplicate module or a module/value collision is the error
	// EK4005, so the retired EK4408 has no interim compatibility identity.
	if m := registry[4005]; m == nil || m.Category != errorCategory || !strings.Contains(m.Text, "redeclares") {
		t.Fatalf("EK4005: %+v; want the VIP-40 module collision error", m)
	}
	for _, code := range []int32{9212, 9213} {
		if registry[code] != nil {
			t.Fatalf("EK%d is registered, but Appendix B allocates no such interim code", code)
		}
	}
}
