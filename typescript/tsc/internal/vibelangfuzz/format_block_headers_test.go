package vibelangfuzz

import (
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/vibelangfmt"
)

// VIP-34, chapter 7: "Comments and their code associations survive, including
// JSDoc, compiler/linter/tool directives and directive-prologue meaning."
// TestFormatBlockHeaderRulesQuoted guards the comment and idempotence rules.
// Vary block kind, line endings, indentation, comment count and nesting.
func FuzzFormatBlockHeaders(f *testing.F) {
	startShortBudget(f)
	checkFormatBlockHeaderRulesQuoted(f)
	keys := []string{"effect-block", "do-block", "do-line", "nested-effect"}
	for _, key := range keys {
		for _, layout := range []uint8{0, 1, 2, 3, 4, 15, 31, 63, 127, 128, 129, 255} {
			f.Add(key, layout)
		}
	}
	host := toolsFormatter(f)
	f.Fuzz(func(t *testing.T, key string, layout uint8) {
		if !slices.Contains(keys, key) {
			key = keys[len(key)%len(keys)]
		}
		newline := []string{"\n", "\r\n", "\r", "\u2028", "\u2029"}[int(layout)%5]
		indent := strings.Repeat(" ", int(layout>>3&3))
		comment := "/* header */"
		if layout&32 != 0 {
			comment += " /* second */"
		}
		body, word, gap := "return 1", "effect", " "
		if strings.HasPrefix(key, "do-") {
			word, body = "do", "1"
			if layout&64 != 0 {
				gap = newline + indent
			}
		}
		if key == "do-line" {
			comment, gap = "// header", newline+indent
		}
		if key == "nested-effect" {
			body = "return try effect /* inner */ { return 1 }"
		}
		source := "const p = " + word + " " + comment + gap + "{ " + body + " }"
		if layout&128 != 0 {
			source = "function outer() {" + newline + indent + source + newline + "}"
		}
		toolsGuard(t, "FuzzFormatBlockHeaders", func() {
			once, err := vibelangfmt.Format("header.vibe", source, host)
			if err != nil {
				Gap(t, "FuzzFormatBlockHeaders", "block-header:"+key+":refusal", "%v\n%s", err, source)
			}
			if err := vibelangfmt.SameProgram(source, once); err != nil {
				Gap(t, "FuzzFormatBlockHeaders", "block-header:"+key+":meaning", "%v\n%s\n%s", err, source, once)
			}
			for _, comment := range []string{"/* header */", "/* second */", "// header", "/* inner */"} {
				if strings.Contains(source, comment) && !strings.Contains(once, comment) {
					Gap(t, "FuzzFormatBlockHeaders", "block-header:"+key+":comment", "lost %s\n%s", comment, once)
				}
			}
			twice, err := vibelangfmt.Format("header.vibe", once, host)
			if err != nil || twice != once {
				Gap(t, "FuzzFormatBlockHeaders", "block-header:"+key+":idempotence", "%v\n%s\n%s", err, once, twice)
			}
		})
	})
}
