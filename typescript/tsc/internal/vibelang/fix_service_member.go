package vibelang

import (
	"context"
	"slices"
	"strconv"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
)

// VIP-10 replaces implementation calls through a key by explicit lookups.
// Real key properties retain their native meaning. Optional calls, plain
// code, Control operations and unknown return phases need no such rewrite.
func serviceMemberMigrationFixes(ctx context.Context, program *compiler.Program, file *ast.SourceFile, refused map[string]bool) proposal {
	p := proposal{file: file}
	if !isVibeLangFile(file) {
		return p
	}
	syntax := program.GetSyntacticDiagnostics(ctx, file)
	c, done := program.GetTypeCheckerForFile(ctx, file)
	defer done()
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if !ast.IsCallExpression(node) || node.QuestionDotToken() != nil || !inLowerableBody(node) || !inEffectCode(node) || inHatch(node) {
			return node.ForEachChild(visit)
		}
		if owner := enclosingFunction(node); owner != nil && slices.ContainsFunc(syntax, func(d *ast.Diagnostic) bool { return owner.Pos() <= d.Pos() && d.Pos() <= owner.End() }) {
			return node.ForEachChild(visit)
		}
		callee := node.Expression()
		if !ast.IsPropertyAccessExpression(callee) || callee.QuestionDotToken() != nil || ast.IsPrivateIdentifier(callee.Name()) {
			return node.ForEachChild(visit)
		}
		receiver := callee.Expression()
		receiverType := c.GetApparentType(c.GetTypeAtLocation(receiver))
		if c.GetPropertyOfType(receiverType, callee.Name().Text()) != nil {
			return node.ForEachChild(visit)
		}
		identifier, shape := legacyServiceMember(c, callee, receiverType)
		if shape == nil || identifier == nil || isControlType(identifier) {
			return node.ForEachChild(visit)
		}
		member := c.GetTypeOfPropertyOfType(shape, callee.Name().Text())
		start := nodeStart(file, receiver)
		key := "service lookup:" + strconv.Itoa(start)
		if refused[key] {
			return node.ForEachChild(visit)
		}
		if len(c.GetSignaturesOfType(member, checker.SignatureKindCall)) == 0 {
			// VIP-5 also retires calling a member that is itself an Effect.
			if at, open, edits, ok := effectValueCallEdits(analyzerFor(c), file, node); ok {
				edits = append(edits, sourceEdit{at, at, open})
				if editsPreserveComments(file.Text(), edits) {
					p.fixes = append(p.fixes, fileFix{key: key, label: "service lookup", edits: edits})
				}
			}
			return node.ForEachChild(visit)
		}
		open := "(try "
		if !underTry(node) && continuesStatement(file.Text(), node, start) {
			open = ";" + open
		}
		suffix := ")"
		if name := moduleServiceKeyName(c, receiver); name != "" {
			suffix = "." + name + suffix
		}
		edits := []sourceEdit{{start, start, open}, {receiver.End(), receiver.End(), suffix}}
		if underTry(node) {
			plain, known := legacyServiceMemberRunMode(c, member)
			if !known {
				return node.ForEachChild(visit)
			}
			if plain {
				site := legacyServiceMemberTrySite(node)
				if site == nil {
					return node.ForEachChild(visit)
				}
				at := nodeStart(file, site)
				if at+3 > len(file.Text()) || !strings.HasPrefix(file.Text()[at:], "try") {
					return node.ForEachChild(visit)
				}
				// A group retains the keyword trivia and starts on its original line,
				// so removing an outer run preserves return/newline and ASI behavior.
				group := "("
				if continuesStatement(file.Text(), site, at) {
					group = ";("
				}
				edits = append(edits, sourceEdit{at, at + 3, group}, sourceEdit{site.End(), site.End(), ")"})
			}
		}
		if editsPreserveComments(file.Text(), edits) {
			p.fixes = append(p.fixes, fileFix{key: key, label: "service lookup", edits: edits})
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
	return p
}

// Old tried plain members ran the lookup only. Retain an outer run for a
// declared Effect result; ambiguous signatures remain an explicit author edit.
func legacyServiceMemberRunMode(c *checker.Checker, member *checker.Type) (plain, known bool) {
	signatures := c.GetSignaturesOfType(member, checker.SignatureKindCall)
	if len(signatures) == 0 {
		return false, false
	}
	first := true
	for _, signature := range signatures {
		result := c.GetReturnTypeOfSignature(signature)
		effect := effectOfValue(c, result) != nil
		if !effect && (len(signature.TypeParameters()) != 0 || result.Flags()&(checker.TypeFlagsAny|checker.TypeFlagsUnknown|checker.TypeFlagsInstantiableNonPrimitive|checker.TypeFlagsUnion|checker.TypeFlagsIntersection) != 0) {
			return false, false
		}
		nextPlain := !effect
		if !first && plain != nextPlain {
			return false, false
		}
		plain, first = nextPlain, false
	}
	return plain, true
}

func legacyServiceMemberTrySite(node *ast.Node) *ast.Node {
	for n := node; ; n = n.Parent {
		if n.Flags&ast.NodeFlagsVibeLangTry != 0 {
			return n
		}
		if tryOperand(n.Parent) == n {
			return n.Parent
		}
		if n.Parent == nil || !ast.IsParenthesizedExpression(n.Parent) {
			return nil
		}
	}
}
