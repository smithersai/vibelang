package vibelangfuzz

import (
	"strings"
	"testing"
)

const editorMatchExtractorQuote = "custom matchers receive `(subject, { matchType })`"
const editorMatchExtractorToolsQuote = "Every tool is tested against the dogfood repositories."

func TestEditorMatchExtractorSpanQuoted(t *testing.T) { editorMatchExtractorSpansQuoted(t) }

func editorMatchExtractorSpansQuoted(t testing.TB) {
	for chapter, quote := range map[string]string{
		"004-match.md":   editorMatchExtractorQuote,
		"007-tooling.md": editorMatchExtractorToolsQuote,
	} {
		if !strings.Contains(SpecText(chapter), quote) {
			t.Fatalf("%s no longer contains %q; review extractor editor coverage", chapter, quote)
		}
	}
}

// VIP-7's qualified, computed and regular-expression matchers remain source
// nodes inside generated extraction calls. VIP-34's editor tooling must work
// at their written positions, including incomplete or unresolved programs.
func editorMatchExtractorSpanSources() []string {
	var sources []string
	for _, matcher := range []string{"Matcher", "Matchers.pick", "Matchers.deep.pick", "Matchers[\"pick\"]", "/a/g"} {
		for _, body := range []string{
			"return match (value) { when " + matcher + "(let item): item; default: undefined; }",
			"if (value is " + matcher + " /* matcher */ (let item)) { return item; }",
		} {
			sources = append(sources, "function read(value: unknown) { "+body+" }")
		}
	}
	// A zero-argument extractor arm written at statement level, as the match
	// chapter's coverage example does: its call span must still contain the
	// extractor name.
	for _, matcher := range []string{"NotFound", "Option.None"} {
		sources = append(sources, "match (value) { when "+matcher+"(): 1; default: 0; }")
	}
	return sources
}

func editorMatchExtractorSpanOffsets(source string) []byte {
	offsets := toolsInterestingOffsets(source)
	for _, marker := range []string{"Matcher", ".", "[", "/a/g", "(let item)", "NotFound", "None", "()"} {
		start := strings.Index(source, marker)
		if start >= 0 {
			for _, offset := range []int{start, start + len(marker)/2, start + len(marker)} {
				offsets = append(offsets, byte(offset>>8), byte(offset))
			}
		}
	}
	return offsets
}
