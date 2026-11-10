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
	// written is the TypeScript type a JSDoc type's diagnostic suggests
	// (TS17019, TS17020), named from the written type.
	written string
	// effect marks a field written with a recognized effect modifier
	// (EK0108); primary is then the field, and code is 0.
	effect bool
}

// TypeScript reports the first modifier error on a type member. Repair every
// ignored class-only modifier, repeated readonly token and readonly on a
// member that is no property or index signature together, so the guarded fix
// does not merely expose the next pre-existing grammar error.
func schemaTypeMemberRepairs(file *ast.SourceFile) []schemaTypeMemberRepair {
	// A type with no schema form keeps no struct call, but its source is a
	// TypeScript type too, whose members keep their grammar errors beside
	// EK2109: a type operator or an Effect type over an object type, a
	// generic type argument, a JSDoc type.
	var bodies []core.TextRange
	var collect func(*ast.Node) bool
	collect = func(node *ast.Node) bool {
		if isSchemaStruct(node) {
			bodies = append(bodies, node.Arguments()[0].Loc)
			return false
		}
		if isUnsupportedSchema(node) && !isNonFieldSchema(node) {
			span := node.Loc
			if span.Pos() >= 0 && span.End() >= span.Pos() && span.End() <= len(file.Text()) {
				bodies = append(bodies, span)
			}
			return false
		}
		return node.ForEachChild(collect)
	}
	file.AsNode().ForEachChild(collect)
	var repairs []schemaTypeMemberRepair
	const prefix = "type $SchemaFields = "
	for _, span := range bodies {
		if span.Pos() < 0 || span.End() > len(file.Text()) {
			continue
		}
		raw := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/schema-modifiers.vibe", PathKey: "/schema-modifiers.vibe"}, prefix+file.Text()[span.Pos():span.End()], core.ScriptKindTS)
		offset := span.Pos() - len(prefix)
		var visit func(*ast.Node) bool
		visit = func(node *ast.Node) bool {
			// A JSDoc type is no TypeScript type: TS17020 for a leading ? or !,
			// TS17019 for a trailing ?, TS8020 for * and a JSDoc type literal,
			// as the checker reports them on a type literal member.
			switch node.Kind {
			case ast.KindJSDocNullableType, ast.KindJSDocNonNullableType:
				inner := node.Type()
				postfix := node.Pos() == inner.Pos()
				token := "?"
				if node.Kind == ast.KindJSDocNonNullableType {
					token = "!"
				}
				written := strings.TrimSpace(raw.Text()[scanner.SkipTrivia(raw.Text(), inner.Pos()):inner.End()])
				if node.Kind == ast.KindJSDocNullableType {
					if postfix {
						written += " | undefined"
					} else {
						written += " | null | undefined"
					}
				}
				code := int32(17020)
				if postfix {
					code = 17019
				}
				span := core.NewTextRange(scanner.SkipTrivia(raw.Text(), node.Pos())+offset, node.End()+offset)
				repairs = append(repairs, schemaTypeMemberRepair{code: code, primary: span, name: token, written: written})
			case ast.KindJSDocAllType, ast.KindJSDocTypeLiteral:
				span := core.NewTextRange(scanner.SkipTrivia(raw.Text(), node.Pos())+offset, node.End()+offset)
				repairs = append(repairs, schemaTypeMemberRepair{code: 8020, primary: span})
			}
			// A readonly belongs on a property or index signature; a method,
			// an accessor and a call or construct signature reject it (TS1024).
			readonlyMember := ast.IsPropertySignatureDeclaration(node) || ast.IsIndexSignatureDeclaration(node)
			if readonlyMember || ast.IsMethodSignatureDeclaration(node) || ast.IsGetAccessorDeclaration(node) ||
				ast.IsSetAccessorDeclaration(node) || ast.IsCallSignatureDeclaration(node) || ast.IsConstructSignatureDeclaration(node) {
				repair := schemaTypeMemberRepair{}
				readonly := false
				for _, modifier := range node.ModifierNodes() {
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
