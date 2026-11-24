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

// Line changes rebuild the formatted text, stay apart where an unchanged line
// separates them, and keep character and line-break boundaries.
func TestSharedFormatterLineChanges(t *testing.T) {
	for _, tc := range []struct {
		before, after string
		changes       int
	}{
		{"const a  =  1\nconst b  =  2\n", "const a = 1\nconst b = 2\n", 2},
		{"const a  =  1\nconst k = 0\nconst b  =  2\n", "const a = 1\nconst k = 0\nconst b = 2\n", 2},
		{"a\n\n\n\nb  \nc\n", "a\n\nb\nc\n", 1},
		{"f(\n1,\n2)\nx  =1\n", "f(1, 2)\nx = 1\n", 1},
		{"// 😀\r\nconst x=1;\r\nconst y = 2;\r\nconst z=\"¢\";\r\n", "// 😀\r\nconst x = 1;\r\nconst y = 2;\r\nconst z = \"£\";\r\n", 2},
		{"const x=1", "const x = 1\n", 1},
		{"", "const x = 1\n", 1},
		{"const x = 1\n", "", 1},
		{"same\n", "same\n", 0},
	} {
		changes := sharedFormatterLineChanges(tc.before, tc.after)
		if len(changes) != tc.changes {
			t.Errorf("%q -> %q has %d changes, want %d: %+v", tc.before, tc.after, len(changes), tc.changes, changes)
		}
		got := tc.before
		for i := len(changes) - 1; i >= 0; i-- {
			change := changes[i]
			if i > 0 && changes[i-1].End() > change.Pos() {
				t.Fatalf("%q -> %q: changes overlap: %+v", tc.before, tc.after, changes)
			}
			if !utf8.ValidString(change.NewText) {
				t.Fatalf("edit splits UTF-8 text: %+v", change)
			}
			for _, position := range []int{change.Pos(), change.End()} {
				if position < len(tc.before) && !utf8.RuneStart(tc.before[position]) {
					t.Fatalf("edit boundary %d splits a character in %q", position, tc.before)
				}
				if position > 0 && position < len(tc.before) && tc.before[position-1] == '\r' && tc.before[position] == '\n' {
					t.Fatalf("edit boundary %d splits CRLF in %q", position, tc.before)
				}
			}
			got = got[:change.Pos()] + change.NewText + got[change.End():]
		}
		if got != tc.after {
			t.Errorf("%q -> %q produced %q", tc.before, tc.after, got)
		}
	}
}
