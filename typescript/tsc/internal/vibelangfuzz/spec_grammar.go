package vibelangfuzz

import (
	"regexp"
	"strings"
)

// The specification writes each grammar production once, in Appendix A of
// docs/design/src/900-appendices.md, in ```text blocks; a chapter names the
// productions it discusses with a link to Appendix A. These helpers are the
// suite's one reader of that grammar: every target that needs the
// productions builds on them or extends them, never a second reader.

const grammarAppendix = "900-appendices.md"

// production is a line that defines a production in a grammar block: a
// PascalCase name, optionally padded, then "=".
var production = regexp.MustCompile(`^([A-Z][A-Za-z0-9]*)\s*=\s`)

// grammarLines returns, for each ```text block of a document, its lines with
// their 1-based line numbers.
func grammarLines(text string) map[int]string {
	lines := map[int]string{}
	in := false
	for i, line := range strings.Split(text, "\n") {
		trimmed := strings.TrimSpace(line)
		switch {
		case !in && trimmed == "```text":
			in = true
		case in && trimmed == "```":
			in = false
		case in:
			lines[i+1] = line
		}
	}
	return lines
}

// appendixProductions returns the productions Appendix A defines: the names
// on the left of "=" in the text blocks of its "### Productions" section.
func appendixProductions(text string) map[string]bool {
	names := map[string]bool{}
	start := strings.Index(text, "## Appendix A")
	if start < 0 {
		return names
	}
	section := text[start:]
	if end := strings.Index(section[1:], "\n## "); end >= 0 {
		section = section[:end+1]
	}
	if p := strings.Index(section, "### Productions"); p >= 0 {
		section = section[p:]
	} else {
		return names
	}
	for _, line := range grammarLines(section) {
		if m := production.FindStringSubmatch(line); m != nil {
			names[m[1]] = true
		}
	}
	return names
}

// anchors returns the anchors a document defines: id and name attributes,
// and its headings' slugs.
func anchors(text string) map[string]bool {
	found := map[string]bool{}
	for _, m := range regexp.MustCompile(`(?:id|name)="([^"]+)"`).FindAllStringSubmatch(text, -1) {
		found[m[1]] = true
	}
	for _, m := range regexp.MustCompile(`(?m)^#+\s+(.+)$`).FindAllStringSubmatch(text, -1) {
		slug := strings.Trim(regexp.MustCompile(`[^a-z0-9]+`).ReplaceAllString(strings.ToLower(m[1]), "-"), "-")
		found[slug] = true
	}
	return found
}
