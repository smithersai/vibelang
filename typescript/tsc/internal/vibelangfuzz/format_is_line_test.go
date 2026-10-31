package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/vibelangfmt"
)

const formatIsLineKey = "key:foldkit-is-line\n"

// FuzzFormat's Chapter 7 oracle, quoted by TestFormatFoldkitQuoted, forbids
// adding line breaks that change the parse. Long subjects make the host wrap
// the relational surrogate before the pattern, where is forbids a line break.
func formatIsLineSource(source string) string {
	if !strings.HasPrefix(source, formatIsLineKey) {
		return source
	}
	data := strings.TrimPrefix(source, formatIsLineKey)
	pick := func(i int) byte {
		if len(data) == 0 {
			return 0
		}
		return data[i%len(data)]
	}
	name := "input" + strings.Repeat("Long", 4+int(pick(0)%45))
	subject := name
	switch pick(1) % 4 {
	case 1:
		subject = "(" + subject + " /* multi\nkept */)"
	case 2:
		subject = "(" + subject + " // kept\n)"
	case 3:
		subject = "(" + subject + ")"
	}
	helper := ""
	if pick(3)&1 != 0 {
		helper = "const choose = (value: Option<number>): Option<number> => value;\n"
		subject = "choose(" + subject + ")"
	}
	before, after := " ", " "
	if pick(2)&1 != 0 {
		before, after = " /* before */ ", " /* after */ "
	}
	pattern := "Option.Some(let value)"
	if pick(2)&2 != 0 {
		pattern = "Option.Some(\n  let value\n)"
	}
	return helper + fmt.Sprintf("export function read(%s: Option<number>): number { if (%s%sis%s%s) { return value } else { return 0 } }", name, subject, before, after, pattern)
}

func TestFormatIsLineGenerator(t *testing.T) {
	host := toolsFormatter(t)
	for length := 0; length < 45; length += 8 {
		for comment := 0; comment < 4; comment++ {
			for call := 0; call < 2; call++ {
				for pattern := 0; pattern < 2; pattern++ {
					source := formatIsLineSource(formatIsLineKey + string([]byte{byte(length), byte(comment), byte(1 | pattern<<1), byte(call)}))
					if syntax := toolsSyntaxError("main.vibe", source); syntax != "" {
						t.Fatalf("%s\n%s", syntax, source)
					}
					once, err := vibelangfmt.Format("main.vibe", source, host)
					if err != nil {
						t.Fatalf("%v\n%s", err, source)
					}
					twice, err := vibelangfmt.Format("main.vibe", once, host)
					if err != nil || once != twice {
						t.Fatalf("not idempotent: %v\n%s\n%s", err, once, twice)
					}
				}
			}
		}
	}
}
