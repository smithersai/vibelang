package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// EK1013 covers comma markers retained as class punctuation by existing
// declaration lowerings. Root error payload Fields use Appendix A Separator;
// the parser marks their comma nodes as synthesized class separators.
// Other retained markers still get this diagnostic and its semicolon fix.

// EK1013: a comma after a field of an error, schema error, or control declaration whose body is a class body. {0} is the declaration's kind, such as "an error".
var EK1013 = message(1013, errorCategory, "The fields of {0} are separated by ; or a new line, not by a comma.")

// EK1306 and EK0908 (decided detail 241, Appendix A Separator): two members
// of an error or schema error body (EK1306) or of a service or control body
// (EK0908) on one line with no separator. The parser reads the gap as an
// empty member of no width; the diagnostic spans the second member's first
// token. {0} is the declaration's kind, such as "an error", and {1} that token.
var (
	EK1306 = message(1306, errorCategory, "The members of {0} need a separator: write ; or a line break before {1}.")
	EK0908 = message(908, errorCategory, "The members of {0} need a separator: write ; or a line break before {1}.")
)

func init() {
	registry[EK1013.Code] = EK1013
	registry[EK1306.Code] = EK1306
	registry[EK0908.Code] = EK0908
	fileChecks = append(fileChecks, checkFieldCommas)
}

// checkFieldCommas reports EK1013 at each comma the parser read after a field.
func checkFieldCommas(c *checker.Checker, file *ast.SourceFile) {
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		if ast.IsClassDeclaration(node) {
			for _, member := range node.Members() {
				if ast.IsSemicolonClassElement(member) && member.Flags&ast.NodeFlagsVibeLang != 0 && member.Flags&ast.NodeFlagsReparsed == 0 && member.Pos() == member.End() {
					next := scanner.GetRangeOfTokenAtPosition(file, member.Pos())
					m := EK0908
					if form, _ := errorFormOf(node); form != errorFormNone {
						m = EK1306
					}
					reportAt(c, file, next, m, fieldDeclarationKind(node), file.Text()[next.Pos():next.End()])
					continue
				}
				// Services admit comma separators, but still reject missing separators above.
				if declarationWord(node) != "service" && ast.IsSemicolonClassElement(member) && member.Flags&ast.NodeFlagsVibeLang != 0 && member.Flags&ast.NodeFlagsReparsed == 0 {
					note(report(c, member, EK1013, fieldDeclarationKind(node)), "Its body is a class body, as in TypeScript.")
				}
			}
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

// fieldDeclarationKind names the declaration that wrote class, for EK1013.
func fieldDeclarationKind(class *ast.Node) string {
	switch form, _ := errorFormOf(class); form {
	case errorFormRoot, errorFormSubclass:
		return "an error"
	case errorFormSchemaRoot, errorFormSchemaSubclass:
		return "a schema error"
	}
	if classKindOf(class) == controlClass {
		return "a control"
	}
	return "a declaration"
}
