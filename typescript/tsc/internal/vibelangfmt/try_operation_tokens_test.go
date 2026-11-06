package vibelangfmt

import "testing"

// Appendix A lets line breaks separate try, the dot and the operation name.
// Formatting keeps the program and is stable.
func TestTryOperationTokenBreaks(t *testing.T) {
	t.Run("identity", func(t *testing.T) {
		testTryOperationTokenBreaks(t, func(text string) (string, error) { return text, nil })
	})
	t.Run("dprint", func(t *testing.T) {
		testTryOperationTokenBreaks(t, dprintFormatter(t))
	})
}

func testTryOperationTokenBreaks(t *testing.T, host TypeScriptFormatter) {
	t.Helper()
	for _, source := range []string{
		"effect function f(xs) { return try\n.all xs }",
		"effect function f(xs) { return try .\nrace xs }",
		"effect function f(xs) { return try\n.\nany xs }",
		"effect function f(xs) { return try\r\n.\r\nallSettled xs }",
	} {
		t.Run(source, func(t *testing.T) {
			first, err := Format("test.vibe", source, host)
			if err != nil {
				t.Fatal(err)
			}
			if err := SameProgram(source, first); err != nil {
				t.Fatal(err)
			}
			second, err := Format("test.vibe", first, host)
			if err != nil {
				t.Fatal(err)
			}
			if first != second {
				t.Fatalf("formatting is not stable:\n%s\n---\n%s", first, second)
			}
		})
	}
}
