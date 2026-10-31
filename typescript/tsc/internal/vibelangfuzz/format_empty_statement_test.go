package vibelangfuzz

import (
	"fmt"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/vibelangfmt"
)

// Chapter 7: "formatting is idempotent". Use the editor's actual TypeScript
// backend as well as the public dprint regressions; they format label trivia
// differently. FuzzFormat keeps the nine keyed neighbourhood witnesses.
func TestEmptyStatementTypeScriptFormattingFixedPoint(t *testing.T) {
	formatter := toolsFormatter(t)
	comments := []string{"/** documentation */", "/** @internal */", "/** @throws {Error} */"}
	gaps := []string{" ", "   ", "\n"}
	hosts := []string{
		"%s\nexport function visible(): number { return 1 }\n",
		"export function outer(): number {\n%s\nfunction visible(): number { return 1 }\nreturn visible()\n}\n",
		"namespace N {\n%s\nexport function visible(): number { return 1 }\n}\n",
	}
	for c, comment := range comments {
		for g, gap := range gaps {
			for h, host := range hosts {
				t.Run(fmt.Sprintf("comment%d/gap%d/host%d", c, g, h), func(t *testing.T) {
					source := fmt.Sprintf(host, comment+gap+";")
					once, err := vibelangfmt.Format("main.vibe", source, formatter)
					if err != nil {
						t.Fatal(err)
					}
					if err := vibelangfmt.SameProgram(source, once); err != nil {
						t.Fatal(err)
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
