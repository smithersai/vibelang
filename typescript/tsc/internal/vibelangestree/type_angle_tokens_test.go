package vibelangestree

import (
	"reflect"
	"strings"
	"testing"
)

// VIP-34: existing ESLint rules receive source tokens. Adjacent type-list
// openings are separate punctuators; an actual shift remains one operator.
func TestTypeAngleTokens(t *testing.T) {
	for _, body := range []string{
		"type X = F<<T>(x: T) => T>;",
		"type X = F<new <T>(x: T) => T>;",
		"const x = f<<T>(x: T) => T>();",
		"const x = new F<<T>(x: T) => T>();",
		"type X = F<<T>(x: T) => F<<U>(y: U) => U>>;",
	} {
		for _, ext := range []string{".ts", ".vibe"} {
			t.Run(body+ext, func(t *testing.T) {
				code := "// é😀\n" + body + "\nconst shift = a << b; value <<= 1; const text = '<<'; const re = /<</;"
				program := parse(t, "/x"+ext, code)
				var actual []string
				for _, entry := range program["tokens"].([]any) {
					token := entry.(map[string]any)
					value := token["value"].(string)
					start, end := rangeOf(token)
					if got := utf16Slice(code, start, end); got != value {
						t.Fatalf("source token %q at [%d,%d] is %q", value, start, end, got)
					}
					if value == "<" || value == "<<" || value == "<<=" {
						actual = append(actual, value)
					}
				}
				count := strings.Count(body, "<")
				want := make([]string, count)
				for i := range want {
					want[i] = "<"
				}
				want = append(want, "<<", "<<=")
				if !reflect.DeepEqual(actual, want) {
					t.Fatalf("angle tokens = %q, want %q", actual, want)
				}
			})
		}
	}
}
