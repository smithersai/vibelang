package vibelangmapper

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
	"strconv"
	"strings"
)

// hasInterleavedServiceMembers detects instance members following static
// members, whose erased shape must be gathered before the generated class.
func hasInterleavedServiceMembers(node *ast.Node) bool {
	if !isServiceClass(node) {
		return false
	}
	static := false
	for _, member := range node.Members() {
		if ast.IsStatic(member) {
			static = true
		} else if static && !ast.IsSemicolonClassElement(member) {
			return true
		}
	}
	return false
}

// interleavedServiceDeclaration gathers the erased instance shape before
// the class, preserving every static initializer in its original order.
func (p *projector) interleavedServiceDeclaration(node *ast.Node) {
	members := node.Members()
	first, last := -1, -1
	for i, member := range members {
		if ast.IsStatic(member) {
			if first < 0 {
				first = i
			}
			last = i
		}
	}
	name := node.Name().Text()
	exported := ""
	if ast.HasSyntacticModifier(node, ast.ModifierFlagsExport) {
		exported = "export "
	}
	start := p.tokenStart(node)
	if modifiers := node.Modifiers(); modifiers != nil {
		for _, modifier := range modifiers.Nodes {
			if modifier.Kind != ast.KindAbstractKeyword && modifier.Flags&ast.NodeFlagsReparsed == 0 {
				start = modifier.End()
			}
		}
	}
	start = scanner.SkipTrivia(p.text, start)
	p.plan.replace(start, node.Name().Pos(), "interface")
	if clauses := node.AsClassDeclaration().HeritageClauses; clauses != nil && clauses.Nodes[0].Flags&ast.NodeFlagsReparsed == 0 {
		p.plan.replace(node.Name().End(), clauses.End(), "")
	}
	var moved strings.Builder
	for i, member := range members {
		if ast.IsStatic(member) || ast.IsSemicolonClassElement(member) {
			continue
		}
		before := len(p.plan.edits)
		p.abstractMember(member)
		if i > first {
			text, ok := p.checkingFragment(member, p.plan.edits[before:])
			if !ok {
				p.unprojected(member)
				return
			}
			moved.WriteString(strings.TrimRight(text, ";, \r\n") + "; ")
			p.plan.edits = p.plan.edits[:before]
			p.plan.replace(p.tokenStart(member), member.End(), "")
		}
	}
	at := p.tokenStart(members[first])
	p.plan.witness(at, moved.String())
	p.plan.insert(at, "readonly \"~vibelang/service\"?: "+strconv.Quote(p.serviceKey(node))+" } "+exported+"abstract class "+name+" extends ")
	base := "service"
	if hasDefaultValue(node) {
		base = "reference"
	}
	p.plan.markFields(editServiceBase, partWhole, at, at, base, p.serviceKey(node), name)
	p.plan.insert(at, " { ")
	for _, member := range members[first : last+1] {
		if ast.IsStatic(member) {
			p.visit(member, env{})
		}
	}
	if isControlClass(node) {
		fields := []string{name}
		for _, member := range members {
			if ast.IsStatic(member) || !ast.IsMethodDeclaration(member) || member.Name() == nil {
				continue
			}
			arity := len(member.Parameters())
			for _, parameter := range member.Parameters() {
				if parameter.AsParameterDeclaration().DotDotDotToken != nil {
					arity = -1
				}
			}
			fields = append(fields, member.Name().Text(), strconv.Itoa(arity))
		}
		p.plan.markFields(editControl, partWhole, node.End(), node.End(), fields...)
	}
}
