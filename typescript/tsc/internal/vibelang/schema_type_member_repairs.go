package vibelang

import (
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

type schemaTypeMemberRepair struct {
	code    int32
	primary core.TextRange
	name    string
	tokens  []core.TextRange
	// effect marks a field written with a recognized effect modifier
	// (EK0108); primary is then the field, and code is 0.
	effect bool
}

// TypeScript reports the first modifier error on a type member. Repair every
// ignored class-only modifier, repeated readonly token and readonly on a
// member that is no property or index signature together, so the guarded fix
// does not merely expose the next pre-existing grammar error.
func schemaTypeMemberRepairs(file *ast.SourceFile) []schemaTypeMemberRepair {
	// A type with no schema form keeps no struct call. Its source is read
	// for effect modifiers only: EK2109 already rejects the type.
	type sourceType struct {
		span       core.TextRange
		effectOnly bool
	}
	var bodies []sourceType
	var collect func(*ast.Node) bool
	collect = func(node *ast.Node) bool {
		if isSchemaStruct(node) {
			bodies = append(bodies, sourceType{span: node.Arguments()[0].Loc})
			return false
		}
		if isUnsupportedSchema(node) && !isNonFieldSchema(node) {
			span := node.Loc
			if span.Pos() >= 0 && span.End() >= span.Pos() && span.End() <= len(file.Text()) {
				text := file.Text()[span.Pos():span.End()]
				if strings.Contains(text, "effect") || strings.Contains(text, "\\u") {
					bodies = append(bodies, sourceType{span: span, effectOnly: true})
				}
			}
			return false
		}
		return node.ForEachChild(collect)
	}
	file.AsNode().ForEachChild(collect)
	var repairs []schemaTypeMemberRepair
	const prefix = "type $SchemaFields = "
	for _, body := range bodies {
		span := body.span
		if span.Pos() < 0 || span.End() > len(file.Text()) {
			continue
		}
		raw := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/schema-modifiers.vibe", PathKey: "/schema-modifiers.vibe"}, prefix+file.Text()[span.Pos():span.End()], core.ScriptKindTS)
		offset := span.Pos() - len(prefix)
		var visit func(*ast.Node) bool
		visit = func(node *ast.Node) bool {
			// A readonly belongs on a property or index signature; a method,
			// an accessor and a call or construct signature reject it (TS1024).
			readonlyMember := ast.IsPropertySignatureDeclaration(node) || ast.IsIndexSignatureDeclaration(node)
			if readonlyMember || ast.IsMethodSignatureDeclaration(node) || ast.IsGetAccessorDeclaration(node) ||
				ast.IsSetAccessorDeclaration(node) || ast.IsCallSignatureDeclaration(node) || ast.IsConstructSignatureDeclaration(node) {
				repair := schemaTypeMemberRepair{}
				readonly := false
				modifiers := node.ModifierNodes()
				if body.effectOnly {
					modifiers = nil
				}
				for _, modifier := range modifiers {
					if modifier.Flags&ast.NodeFlagsReparsed != 0 {
						continue
					}
					code := int32(1070)
					if modifier.Kind == ast.KindReadonlyKeyword {
						if !readonlyMember {
							code = 1024
						} else if !readonly {
							readonly = true
							continue
						} else {
							code = 1030
						}
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
				if isMarkedEffect(node) {
					span := core.NewTextRange(scanner.SkipTrivia(raw.Text(), node.Pos())+offset, node.End()+offset)
					repairs = append(repairs, schemaTypeMemberRepair{primary: span, effect: true})
				}
			}
			return node.ForEachChild(visit)
		}
		raw.AsNode().ForEachChild(visit)
	}
	return repairs
}
