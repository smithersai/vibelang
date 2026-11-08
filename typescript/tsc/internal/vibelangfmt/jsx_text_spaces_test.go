package vibelangfmt

import (
	"regexp"
	"strings"
	"testing"
)

// A host formatter that wraps JSX text writes a space as a {" "} child
// where it breaks a line, and folds such a child into a space where it
// joins lines, as dprint does. Both render the same text, and VIP-39 keeps
// JSX text as written, so formatting restores the written slot.
var (
	jsxJoinedSpace = regexp.MustCompile(`\{" "\}\r?\n[ \t]*`)
	jsxSplitSpace  = regexp.MustCompile(`([A-Za-z.]) (\{[a-z]|<[a-z])`)
)

func TestFormatJSXTextSpaces(t *testing.T) {
	hosts := map[string]TypeScriptFormatter{
		"identity":             func(text string) (string, error) { return text, nil },
		"joins a {\" \"} line": func(text string) (string, error) { return jsxJoinedSpace.ReplaceAllString(text, " "), nil },
		"splits at a space":    func(text string) (string, error) { return jsxSplitSpace.ReplaceAllString(text, "$1{\" \"}\n$2"), nil },
	}
	sources := map[string]string{
		"t3code detached head": "export const View = () => (<span >\n          Detached HEAD: create and check out a branch to enable push and{\" \"}\n          {null} actions.\n        </span>)\n",
		"before an element":    "export const View = () => (\n  <p>\n    Read the{\" \"}\n    <a href=\"x\">docs</a> first.\n  </p>\n)\n",
		"in a fragment":        "export const View = (two: string) => (\n  <>\n    one{\" \"}\n    {two} three\n  </>\n)\n",
		"written on one line":  "export const View = (name: string) => <p>Hello {name} and <b>you</b>.</p>\n",
	}
	for name, source := range sources {
		for hostName, host := range hosts {
			t.Run(name+"/"+hostName, func(t *testing.T) {
				once, err := Format("input.vibex", source, host)
				if err != nil {
					t.Fatal(err)
				}
				if once != source {
					t.Fatalf("JSX text changed:\n%s\nwant:\n%s", once, source)
				}
				twice, err := Format("input.vibex", once, host)
				if err != nil || twice != once {
					t.Fatalf("not idempotent: %v\n%s", err, twice)
				}
			})
		}
	}
}

func TestFormatJSXTextSpacesKeepsTheGuard(t *testing.T) {
	source := "export const View = () => (\n  <p>\n    keep{\" \"}\n    {null} this\n  </p>\n)\n"
	for name, host := range map[string]TypeScriptFormatter{
		"changes the words": func(text string) (string, error) { return strings.Replace(text, "keep", "lose", 1), nil },
		"drops a child":     func(text string) (string, error) { return strings.Replace(text, "{null}", "", 1), nil },
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := Format("input.vibex", source, host); err == nil || !strings.Contains(err.Error(), "JSX") {
				t.Fatalf("accepted a host that %s: %v", name, err)
			}
		})
	}
}

func TestFormatJSXTextSpacesWithDprint(t *testing.T) {
	formatter := dprintFormatterForFile(t, "file.tsx")
	source := "export const View = () => (<span >\n          Detached HEAD: create and check out a branch to enable push and{\" \"}\n          {null} actions.\n        </span>)\n"
	once, err := Format("input.vibex", source, formatter)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(once, "push and{\" \"}\n          {null} actions.") {
		t.Fatalf("JSX text changed:\n%s", once)
	}
	twice, err := Format("input.vibex", once, formatter)
	if err != nil || twice != once {
		t.Fatalf("not idempotent: %v\n%s", err, twice)
	}
}
