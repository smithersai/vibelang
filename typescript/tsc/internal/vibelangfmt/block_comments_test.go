package vibelangfmt

import (
	"strings"
	"testing"
)

func TestEffectBlockHeaderComments(t *testing.T) {
	t.Run("identity", func(t *testing.T) {
		testEffectBlockHeaderComments(t, func(text string) (string, error) { return text, nil })
	})
	t.Run("dprint", func(t *testing.T) {
		testEffectBlockHeaderComments(t, dprintFormatter(t))
	})
}

func testEffectBlockHeaderComments(t *testing.T, host TypeScriptFormatter) {
	t.Helper()
	for _, source := range []string{
		"const p = effect /* explanation */ { return 1 }",
		"const p = effect /* first */ /* second */ { return 1 }",
		"effect function f() { return try effect /* outer */ { return try effect /* inner */ { return 1 } } }",
		"const p = do /* explanation */ { 1 }",
		"const p = do // explanation\n { 1 }",
		"function f() { return do // explanation\n { 1 } }",
		"const p = do /* explanation */\n { 1 }",
		"const p = do // explanation\n\n { 1 }",
		"const p = do // explanation\r\n { 1 }",
		"const p = do // explanation\r { 1 }",
		"function f() { return do // explanation\r { 1 } }",
		"const p = do // explanation\u2028 { 1 }",
		"const p = do // explanation\u2029 { 1 }",

		"const p = do /* explanation\ncontinued */ { 1 }",

		"effect /* explanation */ { return 1 }",
	} {
		t.Run(source, func(t *testing.T) {
			result, err := Format("test.vibe", source, host)
			if err != nil {
				t.Fatal(err)
			}
			for _, comment := range []string{"continued */", "// explanation", "/* explanation */", "/* first */", "/* second */", "/* outer */", "/* inner */"} {
				if strings.Contains(source, comment) && !strings.Contains(result, comment) {
					t.Fatalf("lost %s: %s", comment, result)
				}
			}
			if err := SameProgram(source, result); err != nil {
				t.Fatal(err)
			}
			again, err := Format("test.vibe", result, host)
			if err != nil || again != result {
				t.Fatalf("not idempotent: %q (%v)", again, err)
			}
		})
	}
}
