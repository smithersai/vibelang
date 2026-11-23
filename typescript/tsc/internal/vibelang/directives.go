package vibelang

import (
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// An @vibelang-diagnostics comment changes the category of an adjustable EK
// code for part of a file (D241), as an @effect-diagnostics comment does for
// Effect's language service:
//
//	// @vibelang-diagnostics EK4801:off EK4804:error    from here to the end of the file
//	// @vibelang-diagnostics-next-line EK4801:off        on the next line only
//	// @vibelang-diagnostics *:off                       every adjustable code
//
// The values are those of compilerOptions.vibelang.diagnostics: "error",
// "warning", and "off". A later comment overrides an earlier one, and within
// one comment a code named on its own overrides *. Words after the codes are
// prose, and punctuation ends a category, so a comment can give its reason:
// "EK4801:off: the program is returned". A comment changes only the codes in
// adjustableCodes; every other EK diagnostic keeps its category.

const (
	directiveMarker   = scanner.VibeDiagnosticMarker
	directiveNextLine = "-next-line"
)

// directiveCategory returns the category that file's @vibelang-diagnostics
// comments give m at pos, given the category and on that the project's
// options give it.
func directiveCategory(file *ast.SourceFile, pos int, m *Message, category diagnostics.Category, on bool) (diagnostics.Category, bool) {
	if len(file.VibeDiagnosticComments) == 0 {
		return category, on
	}
	text := file.Text()
	line := strings.Count(text[:pos], "\n")
	var named, wildcard string
	codeName := m.String()
	for _, comment := range file.VibeDiagnosticComments {
		for offset := comment.Pos(); offset < min(pos, comment.End()); {
			i := strings.Index(text[offset:min(pos, comment.End())], directiveMarker)
			if i < 0 {
				break
			}
			start := offset + i
			offset = start + len(directiveMarker)
			if !followsCommentPrefix(text, start) {
				continue
			}
			if strings.HasPrefix(text[offset:comment.End()], directiveNextLine) {
				offset += len(directiveNextLine)
				if strings.Count(text[:start], "\n")+1 != line {
					continue
				}
			}
			end := comment.End()
			if lineEnd := strings.IndexAny(text[offset:end], "\r\n"); lineEnd >= 0 {
				end = offset + lineEnd
			}
			var commentNamed, commentWildcard string
			for field := range strings.FieldsSeq(strings.TrimSuffix(strings.TrimSpace(text[offset:end]), "*/")) {
				code, value, ok := strings.Cut(field, ":")
				// Punctuation ends a category, so a reason can follow it as prose:
				// EK4801:off: why, EK4801:off, EK4818:error.
				value = strings.TrimRight(value, ":;,.")
				switch {
				case !ok:
				case code == codeName:
					commentNamed = value
				case code == "*":
					commentWildcard = value
				}
			}
			if commentWildcard != "" {
				named, wildcard = "", commentWildcard // * sets every code, including those named before
			}
			if commentNamed != "" {
				named = commentNamed
			}
		}
	}
	for _, value := range []string{named, wildcard} {
		if category, on, ok := categoryNamed(value, m); ok {
			return category, on
		}
	}
	return category, on
}

// followsCommentPrefix reports whether the text at start, on its line, follows only a
// comment's opening: //, /*, or the * of a block comment's later line.
func followsCommentPrefix(text string, start int) bool {
	lineStart := strings.LastIndexAny(text[:start], "\r\n") + 1
	before := strings.TrimSpace(text[lineStart:start])
	return before == "//" || before == "/*" || before == "/**" || before == "*"
}
