package vibelang

import (
	"slices"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/nodebuilder"
)

var EK4853 = message(4853, warningCategory, "An omitted requirement slot means never; write {0} to preserve the requirements previously inferred from this body.")

func init() {
	registry[EK4853.Code] = EK4853
	tsFormMessages = append(tsFormMessages, EK4853)
	tsFormFixCodes = append(tsFormFixCodes, EK4853.Code)
	tsFormRules[EK4853.Code] = &tsFormRule{
		message: EK4853,
		find: func(c *checker.Checker, file *ast.SourceFile, report func(*ast.Node, *formRewrite, ...any)) {
			var visit func(*ast.Node) bool
			visit = func(node *ast.Node) bool {
				if ast.IsTypeReferenceNode(node) {
					if r := omittedRequirementRewrite(c, file, node); r.fixable() {
						report(node, r, r.description)
					}
				}
				return node.ForEachChild(visit)
			}
			file.AsNode().ForEachChild(visit)
		},
		plan:      omittedRequirementRewrite,
		diagnosed: ast.IsTypeReferenceNode,
	}
	ls.RegisterCodeFixProvider(&ls.CodeFixProvider{Source: diagnosticSource, ErrorCodes: []int32{EK4853.Code}, GetCodeActions: typeScriptFormFix.GetCodeActions})
}

// omittedRequirementRewrite writes out the R that the retired rule inferred
// for a function with a body whose A!E annotation left R out (VIP-3). The
// parser places the omitted R on the final character of E; an explicitly
// empty slot, as in A!E!, was never inferred and is not migrated.
func omittedRequirementRewrite(c *checker.Checker, file *ast.SourceFile, annotation *ast.Node) *formRewrite {
	if !omitsRequirement(annotation) {
		return nil
	}
	requirements := legacyRequirements(analyzerFor(c), annotation.Parent, map[*ast.Node]bool{})
	if len(requirements) == 0 {
		return nil
	}
	for _, t := range requirements {
		if !inScope(t, annotation) {
			return nil // a type parameter of a callback's contract, which this declaration cannot name
		}
	}
	requirement := c.GetUnionType(requirements)
	if !requirementCanBeNamed(c, requirement, annotation) {
		return nil
	}
	// A diagnostic's context-free display name is not source text: Input
	// may be imported as Renamed, or shadowed by an unrelated local alias.
	printed := c.TypeToStringEx(requirement, annotation, checker.TypeFormatFlagsNoTruncation|checker.TypeFormatFlagsUseFullyQualifiedType, nil)
	slot := bangSlot(printed, true)
	// The inferred union is one requirement slot, including when distinct
	// services share an exported name. Keep it grouped as source syntax.
	if hasTopLevel(slot, "|") || hasTopLevel(slot, "&") {
		slot = "(" + slot + ")"
	}
	text := expressionText(file, annotation) + "!" + slot
	return &formRewrite{description: text, edits: []sourceEdit{{nodeStart(file, annotation), annotation.End(), text}}}
}

// omitsRequirement reports whether annotation is the return annotation of a
// function with a body, written A!E with R left out.
func omitsRequirement(annotation *ast.Node) bool {
	if annotation == nil || !ast.IsTypeReferenceNode(annotation) || !isBodyReturnAnnotation(annotation) || annotation.AsTypeReferenceNode().TypeName.Flags&ast.NodeFlagsReparsed == 0 {
		return false
	}
	args := annotation.TypeArguments()
	return len(args) == 3 && args[2].Kind == ast.KindNeverKeyword && args[2].End() == args[1].End() && args[2].Pos() == args[1].End()-1
}

// legacyRequirements returns what the retired rule inferred for fn's R: what
// its body needs, joined with the legacy R of each function it calls that
// also left R out, so a call cycle is migrated in one round.
func legacyRequirements(a *analyzer, fn *ast.Node, visiting map[*ast.Node]bool) []*checker.Type {
	info := a.effectOf(fn)
	if info == nil || visiting[fn] {
		return nil
	}
	visiting[fn] = true
	requirements := slices.Clone(info.requirements)
	a.forEachRunningCallInBody(fn, func(call *ast.Node) bool {
		if !a.runs(call) {
			return false
		}
		sig := a.checker.GetResolvedSignature(call)
		if sig == nil {
			return false
		}
		if callee := implementationOf(sig.Declaration()); callee != nil && omitsRequirement(callee.Type()) {
			for _, t := range legacyRequirements(a, callee, visiting) {
				if !slices.Contains(requirements, t) {
					requirements = append(requirements, t)
				}
			}
		}
		return false
	})
	return requirements
}

// inScope reports whether t can be written at node: it is not a type
// parameter, or one that a declaration enclosing node declares.
func inScope(t *checker.Type, node *ast.Node) bool {
	if t.Flags()&checker.TypeFlagsTypeParameter == 0 || t.Symbol() == nil {
		return true
	}
	for _, declaration := range t.Symbol().Declarations() {
		for n := node; n != nil; n = n.Parent {
			if n == declaration.Parent {
				return true
			}
		}
	}
	return false
}

// Check every reference in the serialized type, including nested generic
// arguments and union members. The type writer may otherwise recover an
// inaccessible private symbol with an unbound name; even a successful CLI
// check cannot detect that name binding to an unrelated any/unknown alias.
func requirementCanBeNamed(c *checker.Checker, requirement *checker.Type, at *ast.Node) bool {
	symbols := map[*ast.IdentifierNode]*ast.Symbol{}
	node := c.TypeToTypeNode(requirement, at, nodebuilder.FlagsNoTruncation|nodebuilder.FlagsUseFullyQualifiedType, symbols)
	if node == nil {
		return false
	}
	var inaccessible func(*ast.Node) bool
	inaccessible = func(n *ast.Node) bool {
		var name *ast.Node
		value := false
		switch n.Kind {
		case ast.KindTypeReference:
			name = n.AsTypeReferenceNode().TypeName
		case ast.KindTypeQuery:
			name, value = n.AsTypeQueryNode().ExprName, true
		case ast.KindImportType:
			name, value = n.AsImportTypeNode().Qualifier, n.AsImportTypeNode().IsTypeOf
		}
		if name != nil {
			for ast.IsQualifiedName(name) {
				name = name.AsQualifiedName().Right
			}
			symbol := symbols[name]
			if symbol == nil {
				return true
			}
			if value {
				if !c.IsValueSymbolAccessible(symbol, at) {
					return true
				}
			} else if !inScope(c.GetDeclaredTypeOfSymbol(symbol), at) || !c.IsTypeSymbolAccessible(symbol, at) {
				return true
			}
		}
		return n.ForEachChild(inaccessible)
	}
	return !inaccessible(node)
}
