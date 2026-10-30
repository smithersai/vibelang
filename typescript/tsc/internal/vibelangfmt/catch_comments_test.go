package vibelangfmt

import (
	"strings"
	"testing"
)

func TestCatchHandlerComments(t *testing.T) {
	for _, renderer := range []string{"identity", "dprint"} {
		t.Run(renderer, func(t *testing.T) {
			host := TypeScriptFormatter(func(text string) (string, error) { return text, nil })
			if renderer == "dprint" {
				host = dprintFormatter(t)
			}
			for _, source := range []string{
				"effect function f() { return fail(1) catch /* explanation */ () => 7 }",
				"effect function f() { return fail(1) catch /* explanation */ function () { return 7 } }",
				"effect function f() { return fail(1) catch /* explanation */ effect () => 7 }",
				"effect function f() { return fail(1)\n catch /* explanation */ () => 7 }",
				"effect function f() { return fail(1) catch /* explanation */ // line comment\n () => 7 }",
				"effect function f() { return fail(1) catch /* explanation */ /* second */ () => 7 }",
				"effect function f() { return fail(1) /* before */ catch /* explanation */ () => 7 }",
			} {
				t.Run(source, func(t *testing.T) {
					once, err := Format("test.vibe", source, host)
					if err != nil {
						t.Fatal(err)
					}
					if strings.Count(once, "/* explanation */") != 1 {
						t.Fatalf("lost or duplicated comment: %s", once)
					}
					if err := SameProgram(source, once); err != nil {
						t.Fatal(err)
					}
					twice, err := Format("test.vibe", once, host)
					if err != nil || twice != once {
						t.Fatalf("not idempotent: %q (%v)", twice, err)
					}
				})
			}
		})
	}
}
