package vibelangfmt

import (
	"strings"
	"testing"
)

// D372: "Comments survive every rewrite." A comment between a for concurrent
// or for try head and the loop's ( stays after the head.
func TestForHeadTrailingComments(t *testing.T) {
	t.Run("identity", func(t *testing.T) {
		testForHeadTrailingComments(t, func(text string) (string, error) { return text, nil })
	})
	t.Run("dprint", func(t *testing.T) {
		testForHeadTrailingComments(t, dprintFormatter(t))
	})
}

func testForHeadTrailingComments(t *testing.T, host TypeScriptFormatter) {
	t.Helper()
	for _, c := range []struct{ source, head, comment string }{
		{"effect function f() { for concurrent /* c */ (const x of [1]) { } }", "concurrent", "/* c */"},
		{"effect function f() { for concurrent /* a\nb */ (const x of [1]) { } }", "concurrent", "/* a\nb */"},
		{"effect function f() { for concurrent(2) /* c */ (const x of [1]) { } }", "concurrent(2)", "/* c */"},
		{"effect function f() { for concurrent /* c */ (2) (const x of [1]) { } }", "concurrent", "/* c */"},
		{"effect function f() { for concurrent // c\n (const x of [1]) { } }", "concurrent", "// c"},
		{"effect function f() { for try /* c */ (const x of s) { } }", "try", "/* c */"},
		{"effect function f() { for /* before */ concurrent /* c */ (const x of [1]) { } }", "concurrent", "/* c */"},
	} {
		t.Run(c.source, func(t *testing.T) {
			result, err := Format("test.vibe", c.source, host)
			if err != nil {
				t.Fatal(err)
			}
			head := strings.Index(result, "for ")
			word := strings.Index(result[head:], c.head)
			comment := strings.Index(result[head:], c.comment)
			if word < 0 || comment < 0 || comment < word {
				t.Fatalf("the comment %q no longer follows %q:\n%s", c.comment, c.head, result)
			}
			if before := strings.Index(result, "/* before */"); before >= 0 && before > head+word {
				t.Fatalf("the comment before the head moved after it:\n%s", result)
			}
			if err := SameProgram(c.source, result); err != nil {
				t.Fatal(err)
			}
			again, err := Format("test.vibe", result, host)
			if err != nil || again != result {
				t.Fatalf("not idempotent: %q (%v)", again, err)
			}
		})
	}
}
