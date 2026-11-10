package vibelang

import (
	"slices"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

func init() {
	fileChecks = append(fileChecks, checkSchemaDuplicateReadonly)

}

// VIP-15 uses TypeScript field modifiers. Mapping a schema body to an object
// discards its modifiers; recover only their grammar diagnostic from source.
func schemaDuplicateReadonlyRanges(file *ast.SourceFile) []core.TextRange {
	type bodySource struct {
		span  core.TextRange
		class bool
	}
	var bodies []bodySource
	var collect func(*ast.Node) bool
	collect = func(node *ast.Node) bool {
		if isSchemaStruct(node) {
			bodies = append(bodies, bodySource{span: node.Arguments()[0].Loc})
			return false // the source walk below includes nested object types
		}
		if isSchemaErrorFields(node) {
			bodies = append(bodies, bodySource{span: node.Loc, class: true})
			return false
		}
		// A type with no schema form is a TypeScript type too (EK2109).
		if isUnsupportedSchema(node) && !isNonFieldSchema(node) {
			if span := node.Loc; span.Pos() >= 0 && span.End() >= span.Pos() && span.End() <= len(file.Text()) {
				bodies = append(bodies, bodySource{span: span})
			}
			return false
		}
		return node.ForEachChild(collect)
	}
	file.AsNode().ForEachChild(collect)
	var ranges []core.TextRange
	for _, source := range bodies {
		body := source.span
		prefix := "type $SchemaFields = "
		if source.class {
			prefix = "class $SchemaFields "
		}
		if body.Pos() < 0 || body.End() > len(file.Text()) {
			continue
		}
		raw := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/schema-fields.vibe", PathKey: "/schema-fields.vibe"}, prefix+file.Text()[body.Pos():body.End()], core.ScriptKindTS)
		var visit func(*ast.Node) bool
		visit = func(node *ast.Node) bool {
			if source.class && ast.IsClassDeclaration(node) {
				for _, member := range node.AsClassDeclaration().Members.Nodes {
					if ast.IsPropertyDeclaration(member) && !ast.HasSyntacticModifier(member, ast.ModifierFlagsStatic) {
						visit(member)
					}
				}
				return false
			}
			if ast.IsPropertySignatureDeclaration(node) || source.class && ast.IsPropertyDeclaration(node) {
				seen := false
				for _, modifier := range node.ModifierNodes() {
					if modifier.Kind != ast.KindReadonlyKeyword || modifier.Flags&ast.NodeFlagsReparsed != 0 {
						continue
					}
					if seen {
						start := scanner.SkipTrivia(raw.Text(), modifier.Pos()) + body.Pos() - len(prefix)
						span := core.NewTextRange(start, modifier.End()+body.Pos()-len(prefix))
						if !slices.Contains(ranges, span) {
							ranges = append(ranges, span)
						}
						break // TypeScript reports the first repeated modifier per field.
					}
					seen = true
				}
			}
			return node.ForEachChild(visit)
		}
		raw.AsNode().ForEachChild(visit)
	}
	return ranges
}

func checkSchemaDuplicateReadonly(c *checker.Checker, file *ast.SourceFile) {
	for _, span := range schemaDuplicateReadonlyRanges(file) {
		c.AddDiagnostic(ast.NewDiagnostic(file, span, diagnostics.X_0_modifier_already_seen, "readonly"))
	}
}
