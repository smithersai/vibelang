package ast

import (
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

// vibeLangDirective is the line that makes a TypeScript source a VibeLang
// source (VIP-42).
const vibeLangDirective = "// @vibe"

// HasVibeLangDirective reports whether text, the content of fileName, is a
// .ts, .tsx, .mts or .cts source whose first line is the directive. A byte
// order mark and a #! line may come before it, and spaces and tabs after it.
// The decision reads only fileName and those bytes, so the compiler, the
// language server and the formatter cannot disagree about a file. A
// declaration file and every other file keep their own language.
func HasVibeLangDirective(fileName string, text string) bool {
	text = strings.TrimPrefix(text, "\xef\xbb\xbf")
	if strings.HasPrefix(text, "#!") {
		end := strings.IndexByte(text, '\n')
		if end < 0 {
			return false
		}
		text = text[end+1:]
	}
	rest, ok := strings.CutPrefix(text, vibeLangDirective)
	if !ok {
		return false
	}
	rest = strings.TrimLeft(rest, " \t")
	if rest != "" && rest[0] != '\n' && rest[0] != '\r' {
		return false
	}
	return tspath.FileExtensionIsOneOf(fileName, typeScriptSourceExtensions) && !tspath.IsDeclarationFileName(fileName)
}

var typeScriptSourceExtensions = []string{tspath.ExtensionTs, tspath.ExtensionTsx, tspath.ExtensionMts, tspath.ExtensionCts}

// IsVibeLang reports whether node is VibeLang source: a .vibe or .vibex file
// or a TypeScript source with the directive. A question about what a file
// means asks this. A question about how a file is named, such as whether it
// has a declaration sidecar, asks FileName().IsVibeLangSource().
func (node *SourceFile) IsVibeLang() bool {
	return node.FileName().IsVibeLangSource() || HasVibeLangDirective(string(node.FileName()), node.Text())
}
