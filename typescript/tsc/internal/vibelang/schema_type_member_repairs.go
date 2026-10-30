package vibelang

import (
	"slices"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

type schemaTypeMemberRepair struct {
	code    int32
	primary core.TextRange
	name    string
	tokens  []core.TextRange
}

// TypeScript reports the first modifier error on a field. Repair every ignored
// class-only modifier and repeated readonly token together, so the guarded fix
// does not merely expose the next pre-existing grammar error.
func schemaTypeMemberRepairs(file *ast.SourceFile) []schemaTypeMemberRepair {
	var bodies []core.TextRange
	var collect func(*ast.Node) bool
	collect = func(node *ast.Node) bool {
		if isSchemaStruct(node) {
			bodies = append(bodies, node.Arguments()[0].Loc)
			return false
		}
		return node.ForEachChild(collect)
	}
	file.AsNode().ForEachChild(collect)
	var repairs []schemaTypeMemberRepair
	const prefix = "type $SchemaFields = "
	for _, body := range bodies {
		if body.Pos() < 0 || body.End() > len(file.Text()) {
			continue
		}
		raw := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/schema-modifiers.vibe", PathKey: "/schema-modifiers.vibe"}, prefix+file.Text()[body.Pos():body.End()], core.ScriptKindTS)
		offset := body.Pos() - len(prefix)
		var visit func(*ast.Node) bool
		visit = func(node *ast.Node) bool {
			if ast.IsPropertySignatureDeclaration(node) {
				repair := schemaTypeMemberRepair{}
				readonly := false
				for _, modifier := range node.ModifierNodes() {
					if modifier.Flags&ast.NodeFlagsReparsed != 0 {
						continue
					}
					code := int32(1070)
					if modifier.Kind == ast.KindReadonlyKeyword {
						if !readonly {
							readonly = true
							continue
						}
						code = 1030
					} else if ast.IsDecorator(modifier) {
						break
					}
					name := scanner.TokenToString(modifier.Kind)
					if name == "" {
						continue
					} // preserve the explicit mutable marker
					span := core.NewTextRange(scanner.SkipTrivia(raw.Text(), modifier.Pos())+offset, modifier.End()+offset)
					if repair.code == 0 {
						repair.code = code
						repair.primary = span
						repair.name = name
					}
					repair.tokens = append(repair.tokens, span)
				}
				if repair.code != 0 {
					repairs = append(repairs, repair)
				}
			}
			return node.ForEachChild(visit)
		}
		raw.AsNode().ForEachChild(visit)
	}
	return repairs
}

func schemaTypeMemberRepairEdits(fix *ls.CodeFixContext) []*lsproto.TextEdit {
	for _, repair := range schemaTypeMemberRepairs(fix.SourceFile) {
		if slices.Contains(repair.tokens, fix.Span) {
			var edits []*lsproto.TextEdit
			for _, span := range repair.tokens {
				edits = append(edits, replaceRange(fix, span.Pos(), span.End(), "")...)
			}
			return edits
		}
	}
	return nil
}
