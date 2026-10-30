package ls

import (
	"testing"
	"unicode/utf8"
)

func TestSharedFormatterChangePreservesCharacterAndLineBoundaries(t *testing.T) {
	cases := [][2]string{
		{"const x = \"¢\";\n", "const x = '£';\n"},
		{"// 😀\r\nconst x=1;\r\n", "// 😀\nconst x = 1;\n"},
		{"const x=1;\n", "const x=1;\r\n"},
		{"", "const x = 1;\n"},
		{"const x = 1;\n", ""},
		{"// é\n", "// é\n"},
	}
	for _, pair := range cases {
		before, after := pair[0], pair[1]
		change := sharedFormatterChange(before, after)
		if got := change.ApplyTo(before); got != after {
			t.Fatalf("%q -> %q produced %q", before, after, got)
		}
		if !utf8.ValidString(change.NewText) {
			t.Fatalf("edit splits UTF-8 text: %+v", change)
		}
		for _, position := range []int{change.Pos(), change.End()} {
			if position < len(before) && !utf8.RuneStart(before[position]) {
				t.Fatalf("edit boundary %d splits a character in %q", position, before)
			}
			if position > 0 && position < len(before) && before[position-1] == '\r' && before[position] == '\n' {
				t.Fatalf("edit boundary %d splits CRLF in %q", position, before)
			}
		}
	}
}
