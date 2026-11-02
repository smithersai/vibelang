package vibelang

import (
	"fmt"
	"testing"
)

// VIP-7's nested patterns bind as their ordinary property and list tests
// do. The generated captures share the hygienic identity of their hoisted
// assignment targets.
func TestNestedIsSubjectTemporary(t *testing.T) {
	for _, pattern := range []string{"{ items: [let value] }", "{ child: { let value } }"} {
		subject := "({ items: [7], child: { value: 7 } })"
		for _, body := range []string{
			"if (%s is %s) return value; return 0",
			"return (%s is %s) ? value : 0",
		} {
			for _, names := range []string{"", "const $match1=1, $match2=2, $match3=3, $is1=4; void [$match1,$match2,$match3,$is1];"} {
				source := "export function f(): unknown { " + names + fmt.Sprintf(body, subject, pattern) + " }"
				if ds := errorsOf(t, source); len(ds) != 0 {
					t.Errorf("nested subject: %v\n%s", ds, source)
				}
			}
		}
	}
}
