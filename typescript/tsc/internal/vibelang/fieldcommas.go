package vibelang

import (
	"context"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

// EK1013 covers comma markers retained as class punctuation by existing
// declaration lowerings. Root error payload Fields use Appendix A Separator;
// the parser marks their comma nodes as synthesized class separators.
// Other retained markers still get this diagnostic and its semicolon fix.

// EK1013: a comma after a field of an error, schema, schema error, service, or control declaration. {0} is the declaration's kind, such as "an error".
var EK1013 = message(1013, errorCategory, "The fields of {0} are separated by ; or a new line, not by a comma.")

func init() {
	registry[EK1013.Code] = EK1013
	fileChecks = append(fileChecks, checkFieldCommas)
	ls.RegisterCodeFixProvider(fieldCommaFix)
}

// checkFieldCommas reports EK1013 at each comma the parser read after a field.
func checkFieldCommas(c *checker.Checker, file *ast.SourceFile) {
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		if ast.IsClassDeclaration(node) {
			for _, member := range node.Members() {
				if ast.IsSemicolonClassElement(member) && member.Flags&ast.NodeFlagsVibeLang != 0 && member.Flags&ast.NodeFlagsReparsed == 0 {
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
	return "a service"
}

// fieldCommaFix is EK1013's quick fix: it writes ; for the comma the
// diagnostic spans.
var fieldCommaFix = &ls.CodeFixProvider{
	Source:     diagnosticSource,
	ErrorCodes: []int32{EK1013.Code},
	GetCodeActions: func(_ context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
		text := fix.SourceFile.Text()
		if fix.Diagnostic == nil || fix.Span.End() > len(text) || text[fix.Span.Pos():fix.Span.End()] != "," {
			return nil, nil
		}
		return []*ls.CodeAction{{
			Description: "Write ; for the comma",
			Changes:     []*lsproto.TextEdit{{Range: fix.Diagnostic.Range, NewText: ";"}},
		}}, nil
	},
}
