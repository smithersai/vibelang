package vibelangfmt

import (
	"strings"
	"testing"
)

// Formatting must preserve the shorthand and its EK4618 diagnostic. Only
// the existing --fix codemod may insert the missing function keyword.
func TestFormatPreservesFunctionShorthand(t *testing.T) {
	sources := []string{
		"export effect load() { return 1 }\n",
		"export async load() { return 1 }\n",
		"effect /* keep */ load<T>(value: T) { return value }\n",
		"effect function valid() { return 1 }\neffect old() { return 2 }\n",
	}
	for _, source := range sources {
		t.Run(source, func(t *testing.T) {
			got, err := Format("shorthand.vibe", source, func(text string) (string, error) { return text, nil })
			if err != nil {
				t.Fatal(err)
			}
			if got != source {
				t.Fatalf("format repaired shorthand instead of preserving it:\n%s", got)
			}
		})
	}
}

func TestDprintPreservesFunctionShorthand(t *testing.T) {
	formatter := dprintFormatter(t)
	source := "export effect load(){return 1}\nexport async get(){return 2}\n"
	got, err := Format("shorthand.vibe", source, formatter)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(got, "function") {
		t.Fatalf("format removed EK4618 by inserting function:\n%s", got)
	}
	again, err := Format("shorthand.vibe", got, formatter)
	if err != nil {
		t.Fatal(err)
	}
	if got != again {
		t.Fatalf("not idempotent:\n%s\nthen:\n%s", got, again)
	}
}
