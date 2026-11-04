package vibelangmapper

import (
	"strings"
	"testing"
)

func TestServicePropertyModifiers(t *testing.T) {
	text := Project("service Counter { count: number; readonly label: string }", testContext).Text
	for _, want := range []string{
		"interface Counter { count: number; readonly label: string;",
	} {
		if !strings.Contains(text, want) {
			t.Fatalf("missing %q in:\n%s", want, text)
		}
	}
}

// VIP-35 is a removal-only allocation in the first release. Preserve the
// legacy input as a rejection witness rather than expecting its lowering.
func TestRetiredControlPropertyProjectionIdentity(t *testing.T) {
 p := Project("control Legacy { count: number }", testContext)
 found := false
 for _, diagnostic := range p.Diagnostics { if diagnostic.Code == 3501 { found = true } }
 if !found { t.Fatalf("retired control must report EK3501: %+v", p.Diagnostics) }
 if strings.Contains(p.Text, "interface Legacy") { t.Fatalf("retired control was projected: %s", p.Text) }
}
