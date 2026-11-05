package vibelangfuzz

import "strings"

// The legacy source directive remains a per-code setting. Scan actual comment
// tokens independently of the compiler's directive parser, so text in a string
// cannot excuse an unexpected category. Unconfigured codes retain their defaults.
func legacyDirectiveSeverityAt(text string, pos int, code string) (string, bool) {
	if pos < 0 || pos > len(text) {
		return "", false
	}
	const marker = "@vibelang-diagnostics"
	diagnosticLine := strings.Count(text[:pos], "\n")
	named, wildcard := "", ""
	for _, token := range toolsScan(text) {
		if !toolsIsComment(token) || token.start >= pos {
			continue
		}
		offset := 0
		for _, line := range strings.Split(token.text, "\n") {
			at := strings.Index(line, marker)
			start := token.start + offset + at
			offset += len(line) + 1
			if at < 0 || start >= pos {
				continue
			}
			lineStart := strings.LastIndexAny(text[:start], "\r\n") + 1
			prefix := strings.TrimSpace(text[lineStart:start])
			if prefix != "//" && prefix != "/*" && prefix != "/**" && prefix != "*" {
				continue
			}
			rest := line[at+len(marker):]
			if strings.HasPrefix(rest, "-next-line") {
				if strings.Count(text[:start], "\n")+1 != diagnosticLine {
					continue
				}
				rest = strings.TrimPrefix(rest, "-next-line")
			}
			thisNamed, thisWildcard := "", ""
			for _, field := range strings.Fields(strings.TrimSuffix(strings.TrimSpace(rest), "*/")) {
				key, value, ok := strings.Cut(field, ":")
				if !ok {
					continue
				}
				value = strings.TrimRight(value, ":;,.")
				if key == code {
					thisNamed = value
				}
				if key == "*" {
					thisWildcard = value
				}
			}
			if thisWildcard != "" {
				named, wildcard = "", thisWildcard
			}
			if thisNamed != "" {
				named = thisNamed
			}
		}
	}
	for _, value := range []string{named, wildcard} {
		switch value {
		case "error", "warning", "off":
			return value, true
		}
	}
	return "", false
}
