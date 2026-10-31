package vibelangfuzz

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/vibelangfmt"
	"strings"
	"testing"
)

// Use the actual TypeScript formatter to check Chapter7's idempotence and
// FuzzFormat's existing program/diagnostic identity oracle, rather than an
// identity callback that leaves the class proxy unformatted.
func TestErrorFieldCommaTypeScriptFixedPoint(t *testing.T) {
	t.Setenv("VIBELANG_DPRINT", "")
	formatter := toolsFormatter(t)
	bodies := []string{
		"id: string, code: number",
		"id: string, get label() { return this.id }",
		"pair: [string, number], code: number",
		"id: string /* keep */, /* next */ get label() { return this.id }",
	}
	for _, kind := range []string{"error", "schema error"} {
		for n, body := range bodies {
			for _, gap := range []string{" ", "\n"} {
				t.Run(fmt.Sprintf("%s/body%d/gap%q", kind, n, gap), func(t *testing.T) {
					source := kind + " E {" + gap + body + gap + "}\n"
					once, err := vibelangfmt.Format("main.vibe", source, formatter)
					if err != nil {
						t.Fatal(err)
					}
					if err := vibelangfmt.SameProgram(source, once); err != nil {
						t.Fatal(err)
					}
					if strings.Count(source, ",") != strings.Count(once, ",") {
						t.Fatalf("changed payload separator: %s", once)
					}
					for _, comment := range []string{"/* keep */", "/* next */"} {
						if strings.Contains(source, comment) && !strings.Contains(once, comment) {
							t.Fatalf("lost %s: %s", comment, once)
						}
					}
					twice, err := vibelangfmt.Format("main.vibe", once, formatter)
					if err != nil {
						t.Fatal(err)
					}
					if twice != once {
						t.Fatalf("not a fixed point:\nonce:\n%stwice:\n%s", once, twice)
					}
				})
			}
		}
	}
}
