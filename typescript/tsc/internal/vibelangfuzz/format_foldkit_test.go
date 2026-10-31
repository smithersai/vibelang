package vibelangfuzz

import (
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/vibelangfmt"
)

// Chapter 7: "never insert or remove a line break or parentheses that change
// the parse". These keyed FuzzFormat inputs generate nested Option control
// flow; the existing oracle checks parse identity, compilation and idempotence.
const formatFoldkitKey = "key:foldkit-native-option-control\n"
const formatFoldkitQuote = "never insert or remove a line break or parentheses that change the parse"

func TestFormatFoldkitQuoted(t *testing.T) {
	text, err := os.ReadFile(SpecPath("007-tooling.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(text), formatFoldkitQuote) {
		t.Fatalf("Chapter 7 no longer says %q", formatFoldkitQuote)
	}
}

func formatFoldkitSource(source string) string {
	if !strings.HasPrefix(source, formatFoldkitKey) {
		return source
	}
	data := []byte(strings.TrimPrefix(source, formatFoldkitKey))
	pick := func(i int) byte {
		if len(data) == 0 {
			return 0
		}
		return data[i%len(data)]
	}
	group := func(text string, n byte) string {
		for range int(n % 3) {
			text = "(" + text + ")"
		}
		return text
	}
	var expression func(int) string
	expression = func(depth int) string {
		if depth == 0 {
			return "value"
		}
		inner := expression(depth - 1)
		return group("match (input) { when Option.None: 0; when Option.Some(let value): "+inner+"; }", pick(depth+2))
	}
	expr := expression(1 + int(pick(0)%3))
	body := "return " + expr + ";"
	if pick(1)&1 != 0 {
		yes, no := "return "+expr+";", "return 0;"
		if pick(1)&2 != 0 {
			yes = "{" + yes + "}"
		}
		if pick(1)&4 != 0 {
			no = "{" + no + "}"
		}
		condition := group("input is Option.Some(let value)", pick(2))
		body = "if (" + condition + ") " + yes + " else " + no
	}
	// The wrapper's blocks keep their braces under every host style, so the
	// emitted JavaScript differs only if an is body changed. A grouped match
	// statement is a formatter fixture (minimal/statement): under ASI styling
	// its guard semicolon is an empty statement the emit oracle counts.
	if pick(3)&1 != 0 {
		body = "if (true) {const ok = true; " + body + "} else return 0;"
	}
	return fmt.Sprintf("export function read(input: Option<number>): number { %s }", body)
}

func TestFormatFoldkitGenerator(t *testing.T) {
	formatter := toolsFormatter(t)
	for a := 0; a < 3; a++ {
		for b := 0; b < 8; b++ {
			for c := 0; c < 3; c++ {
				source := formatFoldkitSource(formatFoldkitKey + string([]byte{byte(a), byte(b), byte(c), 1}))
				if syntax := toolsSyntaxError("main.vibe", source); syntax != "" {
					t.Fatalf("%s\n%s", syntax, source)
				}
				once, err := vibelangfmt.Format("main.vibe", source, formatter)
				if err != nil {
					t.Fatalf("%v\n%s", err, source)
				}
				twice, err := vibelangfmt.Format("main.vibe", once, formatter)
				if err != nil || once != twice {
					t.Fatalf("unstable: %v\n%s\n%s", err, once, twice)
				}

			}
		}
	}
}
