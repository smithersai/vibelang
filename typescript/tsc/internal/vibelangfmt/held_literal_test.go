package vibelangfmt

import (
	"strings"
	"testing"
)

// thirdIndent formats TypeScript by dividing each line's leading spaces by
// three, as moving from six-space to two-space indentation does. It leaves
// lines that start inside a template literal alone, as a formatter must.
func thirdIndent(text string) (string, error) {
	lines := strings.Split(text, "\n")
	inTemplate := false
	for i, line := range lines {
		if !inTemplate {
			trimmed := strings.TrimLeft(line, " ")
			lines[i] = strings.Repeat(" ", (len(line)-len(trimmed))/3) + trimmed
		}
		if strings.Count(line, "`")%2 == 1 {
			inTemplate = !inTemplate
		}
	}
	return strings.Join(lines, "\n"), nil
}

func TestHeldFormKeepsMultiLineLiterals(t *testing.T) {
	for _, test := range []struct{ source, literal string }{
		{
			"service Greeting: string {}\neffect function a() {\n      provide Greeting = `hello\n      world` {\n            try Console.log(try Greeting)\n      }\n}\n",
			"`hello\n      world`",
		},
		{
			"service Greeting: string {}\neffect function a() {\n      provide Greeting = `a ${`b\n      c`} d\n      e` {\n            try Console.log(try Greeting)\n      }\n}\n",
			"`a ${`b\n      c`} d\n      e`",
		},
		{
			"service Greeting: string {}\neffect function a() {\n      provide Greeting = \"hello\\\n      world\" {\n            try Console.log(try Greeting)\n      }\n}\n",
			"\"hello\\\n      world\"",
		},
	} {
		t.Run(test.source, func(t *testing.T) {
			result, err := Format("test.vibe", test.source, thirdIndent)
			if err != nil {
				t.Fatal(err)
			}
			if !strings.Contains(result, test.literal) {
				t.Fatalf("literal changed:\n%s", result)
			}
			if !strings.Contains(result, "\n  provide Greeting") {
				t.Fatalf("held form not re-indented:\n%s", result)
			}
		})
	}
}

func TestByteOrderMarkBeforeShebang(t *testing.T) {
	source := "\xef\xbb\xbf#!/usr/bin/env node\nerror Empty\n"
	result, err := Format("test.vibe", source, func(text string) (string, error) { return text, nil })
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(result, "\xef\xbb\xbf#!/usr/bin/env node\n") {
		t.Fatalf("lost the byte order mark or the shebang: %q", result)
	}
	if err := SameProgram(source, result); err != nil {
		t.Fatal(err)
	}
}
