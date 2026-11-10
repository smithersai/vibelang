package vibelangfmt

import "testing"

// Formatting keeps a named fork owner's program, including an Effect run in
// fork.in's scope, and is stable.
func TestForkOwnerForms(t *testing.T) {
	t.Run("identity", func(t *testing.T) {
		testForkOwnerForms(t, func(text string) (string, error) { return text, nil })
	})
	t.Run("dprint", func(t *testing.T) {
		testForkOwnerForms(t, dprintFormatter(t))
	})
}

func testForkOwnerForms(t *testing.T, host TypeScriptFormatter) {
	t.Helper()
	for _, source := range []string{
		"fork.in(0)A",
		"effect function f(s, e) { return fork.in(s)e }",
		"effect function f(s, e) { return fork.in(s)e() }",
		"effect function f(s, e) { return fork.in(s)1 }",
		"effect function f(s, e) { return fork.in(s)0x1 }",
		"effect function f(s, e) { return fork.in(s)\\u0065 }",
		"effect function f(s, café) { return fork.in(s)café }",
		"effect function f(s, e) { return fork.in(s)typeof e }",
		"effect function f(s, e) { return fork.in(s)(e) }",
		"effect function f(s, e) { return fork.in(s)/* operand */e }",
		"effect function f(s, e) { return fork.in(s) e }",
		"effect function f(s, e) { return fork . in ( s ) e }",
		"effect function f(s, e) { return fork\n.in(s) e }",
		"effect function f(s, e) { return fork.in(try s) e }",
		"effect function f(e) { return fork.scoped e }",
		"effect function f(e) { return fork\n.\ndetached e() }",
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
