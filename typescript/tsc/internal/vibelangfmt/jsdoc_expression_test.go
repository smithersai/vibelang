package vibelangfmt

import (
	"strings"
	"testing"
)

func TestFormatJSDocParenthesizedAssignment(t *testing.T) {
	formatter := dprintFormatter(t)
	source := "/** A module. */\n({ value: 0 }).value = 1;\n"
	once, err := Format("main.vibe", source, formatter)
	if err != nil {
		t.Fatal(err)
	}
	if err := SameProgram(source, once); err != nil {
		t.Fatal(err)
	}
	twice, err := Format("main.vibe", once, formatter)
	if err != nil || twice != once {
		t.Fatalf("unstable formatting: %v\n%s\nthen:\n%s", err, once, twice)
	}
	if strings.Count(once, "/** A module. */") != 1 {
		t.Fatal("documentation changed", once)
	}
}

func TestFormatJSDocExpressionNeighborhood(t *testing.T) {
	formatter := dprintFormatter(t)
	expressions := []string{"({ value: 0 }).value = 1;", "(receiver as { disabled?: boolean }).disabled = true;", "(invoke)();", "(receiver).value = invoke();", "[value] = [1];"}
	comments := []string{"/** documentation */", "/** @internal */", "/** @throws {Error} */", "/** first */\n/** second */"}
	contexts := [][2]string{{"", ""}, {"function run() {\n", "\n}"}, {"if (ready) {\n", "\n}"}, {"class Run { method() {\n", "\n} }"}}
	for _, expression := range expressions {
		for _, comment := range comments {
			for _, context := range contexts {
				source := context[0] + comment + "\n" + expression + context[1] + "\n"
				t.Run(source, func(t *testing.T) {
					once, err := Format("main.vibe", source, formatter)
					if err != nil {
						t.Fatal(err)
					}
					if err := SameProgram(source, once); err != nil {
						t.Fatal(err)
					}
					twice, err := Format("main.vibe", once, formatter)
					if err != nil || twice != once {
						t.Fatalf("unstable formatting: %v\n%s\nthen:\n%s", err, once, twice)
					}
				})
			}
		}
	}
}
