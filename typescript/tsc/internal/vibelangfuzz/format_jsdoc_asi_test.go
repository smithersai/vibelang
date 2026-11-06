package vibelangfuzz

import (
	"github.com/microsoft/TypeScript/tsc/internal/vibelangfmt"
	"strings"
	"testing"
)

const formatJSDocASIQuote = "Comments and their code associations survive, including JSDoc, compiler/linter/tool directives and directive-prologue meaning."
const formatJSDocIdempotenceQuote = "An unparsable file is reported and left unchanged; formatting is idempotent."

func TestFormatJSDocASIQuoted(t *testing.T) {
	chapter := SpecText("007-tooling.md")
	for _, quote := range []string{formatJSDocASIQuote, formatJSDocIdempotenceQuote} {
		if !strings.Contains(chapter, quote) {
			t.Fatal("Chapter 007 no longer contains", quote)
		}
	}
}

// The chapter requires comment association and idempotence, independently of
// whether the host formatter normally inserts an ASI guard. Stable construct
// keys also keep a corpus witness independent of this list's ordering.
func FuzzFormatJSDocASI(f *testing.F) {
	startShortBudget(f)
	keys := []string{"parenthesized-object", "cast-assignment", "parenthesized-call", "assignment-call", "parenthesized-receiver", "destructuring"}
	for _, key := range keys {
		for n := uint8(0); n < 16; n++ {
			f.Add(key, n)
		}
	}
	formatter := toolsFormatter(f)
	f.Fuzz(func(t *testing.T, key string, variant uint8) {
		TestFormatJSDocASIQuoted(t)
		expressions := map[string]string{
			"parenthesized-object":   "({ value: 0 }).value = 1;",
			"cast-assignment":        "(receiver as { disabled?: boolean }).disabled = true;",
			"parenthesized-call":     "(invoke)();",
			"assignment-call":        "(receiver as { value: number }).value = invoke();",
			"parenthesized-receiver": "(receiver).value = invoke();",
			"destructuring":          "[value] = [1];",
		}
		expression, ok := expressions[key]
		if !ok {
			if key == "" {
				return
			}
			key = keys[int(key[0])%len(keys)]
			expression = expressions[key]
		}
		comments := []string{"/** documentation */", "/** @internal */", "/** @throws {Error} */", "/** first */\n/** second */"}
		contexts := [][2]string{{"", ""}, {"function run() {\n", "\n}"}, {"if (ready) {\n", "\n}"}, {"class Run { method() {\n", "\n} }"}}
		context := contexts[int(variant/4)%len(contexts)]
		source := context[0] + comments[int(variant)%len(comments)] + "\n" + expression + context[1] + "\n"
		once, err := vibelangfmt.Format("main.vibe", source, formatter)
		if err != nil {
			Gap(t, "FuzzFormatJSDocASI", "format:jsdoc-asi:"+key, "Chapter 007 comment association: %v\n%s", err, source)
		}
		if err := vibelangfmt.SameProgram(source, once); err != nil {
			Gap(t, "FuzzFormatJSDocASI", "format:jsdoc-asi:"+key, "Chapter 007 comment association: %v\n%s", err, source)
		}
		for _, comment := range []string{"/** documentation */", "/** @internal */", "/** @throws {Error} */", "/** first */", "/** second */"} {
			if strings.Count(source, comment) != strings.Count(once, comment) {
				Gap(t, "FuzzFormatJSDocASI", "format:jsdoc-comments:"+key, "Chapter 007 lost or duplicated %s", comment)
			}
		}
		twice, err := vibelangfmt.Format("main.vibe", once, formatter)
		if err != nil || once != twice {
			Gap(t, "FuzzFormatJSDocASI", "format:jsdoc-idempotence:"+key, "Chapter 007 idempotence: %v\n%s\nthen:\n%s", err, once, twice)
		}
	})
}
