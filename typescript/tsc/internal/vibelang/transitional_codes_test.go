package vibelang

import (
	"os"
	"regexp"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// Transitional, migration and removal codes keep the assignments their
// sources give them until a coordinated renumber. Each code stays registered
// under its number, with the severity its Appendix B row states and the
// subject that row names.
// Appendix B: transitional assignments — spec-rule: docs/design/src/900-appendices.md#08cc868d41fb3b7e
func TestTransitionalCodesKeepTheirAssignments(t *testing.T) {
	t.Parallel()
	spec, err := os.ReadFile("../../../../docs/design/src/900-appendices.md")
	if err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		message *Message
		subject string
	}{
		{EK1023, "0.0.10"},
		{EK4607, "select"},
		{EK4853, "requirement"},
		{EK4854, "service declaration"},
		{EK4855, "static default"},
		{EK4856, "Effect type alias"},
		{EK4857, "infer"},
	} {
		code := test.message.String()
		t.Run(code, func(t *testing.T) {
			t.Parallel()
			if registry[test.message.Code] != test.message {
				t.Fatalf("%s is not registered under its number", code)
			}
			row := regexp.MustCompile("(?m)^\\| `" + code + "` \\| ([^|]*)").FindSubmatch(spec)
			if row == nil {
				t.Fatalf("Appendix B has no %s row", code)
			}
			want := diagnostics.CategoryError
			if strings.HasPrefix(string(row[1]), "warning") {
				want = diagnostics.CategoryWarning
			}
			if test.message.Category != want {
				t.Errorf("%s category = %v, Appendix B row %q gives %v", code, test.message.Category, string(row[1])[:40], want)
			}
			if !strings.Contains(test.message.Text, test.subject) {
				t.Errorf("%s text %q does not name %q", code, test.message.Text, test.subject)
			}
		})
	}
}
