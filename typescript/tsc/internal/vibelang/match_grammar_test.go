package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// TestArmSeparatorFix checks that EK0701's quick fix writes ; at the end of an
// arm, and over a comma.
func TestArmSeparatorFix(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct{ name, source, want string }{
		{"new line", "export function f(b: boolean) {\n  return match (b) {\n    when true: 1\n    default: 0;\n  }\n}\n", "when true: 1;\n"},
		{"last arm", "export function f(b: boolean) {\n  return match (b) { when true: 1; default: 0 }\n}\n", "default: 0; }"},
		{"comma", "export function f(b: boolean) {\n  return match (b) { when true: 1, default: 0; }\n}\n", "when true: 1; default: 0;"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			fixed := applyQuickFixOf(t, tc.source, EK0701.Code, diagnostics.CategoryError)
			if !strings.Contains(fixed, tc.want) {
				t.Fatalf("fixed source lacks %q:\n%s", tc.want, fixed)
			}
		})
	}
}
// VIP-7 mandatory final and intermediate arm semicolons; newline and comma fixes; rule: docs/design/vips/0007-match.md#4fa0bef7a356de99
