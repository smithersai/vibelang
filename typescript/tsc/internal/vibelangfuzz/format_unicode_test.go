package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/vibelangfmt"
)

// Chapter 7 / VIP-34: "formatting is idempotent."
const formatBlockHeaderIdempotenceQuote = "formatting is idempotent."

func checkFormatBlockHeaderRulesQuoted(tb testing.TB) {
	tb.Helper()
	checkFormatContractCommentQuote(tb)
	if !strings.Contains(SpecText("007-tooling.md"), formatBlockHeaderIdempotenceQuote) {
		tb.Fatal("chapter 7 changed its formatter idempotence contract")
	}
}

//gate:spec-tests
func TestFormatBlockHeaderRulesQuoted(t *testing.T) {
	checkFormatBlockHeaderRulesQuoted(t)
}

func TestFormatUnicodeLineSeparators(t *testing.T) {
	checkFormatBlockHeaderRulesQuoted(t)
	host := toolsFormatter(t)
	for _, newline := range []string{"\n", "\r", "\r\n", "\u2028", "\u2029"} {
		for _, indent := range []string{"", " ", "   "} {
			for i, body := range []string{
				"const p=1;",
				"const p=effect /* header */ { return 1 }",
				"const p=do // header" + newline + "{ 1 }",
				"const s=\"x\u2028y\"; const t=`x\u2029y`;",
			} {
				t.Run(fmt.Sprintf("%q/%d/%d", newline, len(indent), i), func(t *testing.T) {
					source := "function outer() {" + newline + indent + body + newline + "}"
					once, err := vibelangfmt.Format("unicode.vibe", source, host)
					if err != nil {
						t.Fatal(err)
					}
					if err := vibelangfmt.SameProgram(source, once); err != nil {
						t.Fatal(err)
					}
					twice, err := vibelangfmt.Format("unicode.vibe", once, host)
					if err != nil || twice != once {
						t.Fatalf("formatting changed on the second pass: %v\nsource=%q\nonce=%q\ntwice=%q", err, source, once, twice)
					}
				})
			}
		}
	}
}
