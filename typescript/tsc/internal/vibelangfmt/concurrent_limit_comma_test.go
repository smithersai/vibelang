package vibelangfmt

import "testing"

func TestConcurrentLimitCommaFormat(t *testing.T) {
	for _, host := range []string{"identity", "dprint"} {
		t.Run(host, func(t *testing.T) {
			var format TypeScriptFormatter = func(text string) (string, error) { return text, nil }
			if host == "dprint" {
				format = dprintFormatter(t)
			}
			for _, limit := range []string{"(mark(1), 1)", "((mark(1), mark(2), 1))", "(mark(1) /* π */, 1)", "choose(mark(1), 1)", "[mark(1), 1][1]"} {
				source := "effect function f() { for concurrent(" + limit + ") (const n of [1]) {} }\n"
				got, err := Format("limit.vibe", source, format)
				if err != nil {
					t.Fatalf("format %s: %v", limit, err)
				}
				if err := SameProgram(source, got); err != nil {
					t.Fatal(err)
				}
				again, err := Format("limit.vibe", got, format)
				if err != nil || again != got {
					t.Fatalf("not idempotent: %v\n%s\n%s", err, got, again)
				}
			}
			if _, err := Format("limit.vibe", "effect function f() { for concurrent(mark(1), 1) (const n of [1]) {} }\n", format); err == nil {
				t.Fatal("format accepted a bare comma limit instead of requiring its syntax repair")
			}
		})
	}
}
