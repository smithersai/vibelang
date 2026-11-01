package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/vibelangfmt"
)

const formatLabelKey = "key:foldkit-labeled-arrow\n"
const formatLabelQuote = "bindings and scopes, operator and control-flow targets, evaluation order"

//gate:spec-tests
func TestFormatLabelQuoted(t *testing.T) {
	if !strings.Contains(SpecText("007-tooling.md"), formatLabelQuote) {
		t.Fatalf("chapter 7 no longer says %q", formatLabelQuote)
	}
}

func formatLabelSource(source string) string {
	if !strings.HasPrefix(source, formatLabelKey) {
		return source
	}
	data := []byte(strings.TrimPrefix(source, formatLabelKey))
	pick := func(i int) byte {
		if len(data) == 0 {
			return 0
		}
		return data[i%len(data)]
	}
	arrow := "(x: number) => x + a"
	if pick(0)&1 != 0 {
		arrow = "(x: number) => { return x + a }"
	}
	if pick(0)&2 != 0 {
		arrow = "async " + arrow
	}
	for range int(pick(1) % 3) {
		arrow = "(" + arrow + ")"
	}
	label := "ChangedUrl: "
	if pick(0)&4 != 0 {
		label = "outer: " + label
	}
	gap := []string{" ", "\n", " /* handler */ ", "\r\n", " // handler\n", "\n\n"}[pick(2)%6]
	result := fmt.Sprintf("const a = 1;\n%s%s%s\n", label, gap, arrow)
	if pick(0)&16 != 0 {
		result = "module handlers {\n" + result + "}\n"
	}
	return result
}

func TestFormatLabelGenerator(t *testing.T) {
	formatter := toolsFormatter(t)
	for _, body := range []byte{0, 1, 2, 3, 4, 5, 6, 7, 16, 17, 20, 23} {
		for groups := byte(0); groups < 3; groups++ {
			for trivia := byte(0); trivia < 6; trivia++ {
				source := formatLabelSource(formatLabelKey + string([]byte{body, groups, trivia}))
				if syntax := toolsSyntaxError("main.vibe", source); syntax != "" {
					t.Fatalf("%s\n%s", syntax, source)
				}
				once, err := vibelangfmt.Format("main.vibe", source, formatter)
				if err != nil {
					t.Fatalf("%v\n%s", err, source)
				}
				twice, err := vibelangfmt.Format("main.vibe", once, formatter)
				if err != nil || twice != once {
					t.Fatalf("unstable: %v\n%s\n%s", err, once, twice)
				}
			}
		}
	}
}
