package vibelangmapper

import (
	"strconv"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// Error declarations written with a class's features (D278) and schema
// errors (D279) project to the class the fork reads them as. The source
// text stays where it is: the keyword becomes class, the base is written
// after the name, and each field becomes a declare member, readonly unless
// written mutable, so a hover on a field still lands on source text. The
// constructor of an error without extends takes the fields, so its base's
// type argument repeats them:
//
//	error Validated { code: string; constructor(code: string) { ... } }
//	class Validated extends TaggedError("Validated")<{ readonly code: string; }> { declare readonly code: string; constructor(code: string) { ... } }
//
//	error Missing extends NotFound { path: string }
//	class Missing extends $errorSubclass(NotFound, "Missing") { declare readonly _tag: "Missing"; constructor(args: $ErrorArgs<typeof NotFound, Pick<Missing, "path">>) { super(args) } declare readonly path: string }
//
//	schema error FsError { method: string }
//	class FsError extends Schema.TaggedError<FsError>()("FsError", { method: Schema.String }) { declare readonly method: string }
//
// The static block through which the fork's schema error joins its family
// (D304) changes no type, so the projection leaves it out.

// errorClassForm is the class an error declaration's parser output is.
type errorClassForm int

const (
	errorClassNone errorClassForm = iota
	errorClassRoot
	errorClassSubclass
	errorClassSchemaRoot
	errorClassSchemaSubclass
)

// errorClassFormOf returns which error declaration node is, if any.
func errorClassFormOf(node *ast.Node) errorClassForm {
	if node.Kind != ast.KindClassDeclaration || node.Flags&ast.NodeFlagsReparsed != 0 {
		return errorClassNone
	}
	base := extendsElement(node)
	if base == nil {
		// error X implements Y: an implements clause after the parser's extends.
		if extends := ast.GetClassExtendsHeritageElement(node); extends != nil {
			base = extends
		} else {
			return errorClassNone
		}
	}
	call := base.Expression()
	if call.Kind != ast.KindCallExpression {
		return errorClassNone
	}
	callee := call.Expression()
	synthesized := func(n *ast.Node, name string) bool {
		return n.Kind == ast.KindIdentifier && n.Flags&ast.NodeFlagsReparsed != 0 && n.Text() == name
	}
	switch {
	case synthesized(callee, "TaggedError") && len(base.TypeArguments()) == 1:
		return errorClassRoot
	case synthesized(callee, "$errorSubclass") && len(call.Arguments()) == 2:
		return errorClassSubclass
	case callee.Kind == ast.KindCallExpression && callee.Expression().Kind == ast.KindPropertyAccessExpression:
		access := callee.Expression()
		if synthesized(access.Name(), "TaggedError") {
			return errorClassSchemaRoot
		}
		if synthesized(access.Name(), "extend") {
			return errorClassSchemaSubclass
		}
	}
	return errorClassNone
}

// hasClassFeatures reports whether node, an error without extends, is
// written with a class's features: abstract, implements, or a member.
func hasClassFeatures(node *ast.Node) bool {
	return len(node.Members()) != 0 || ast.HasSyntacticModifier(node, ast.ModifierFlagsAbstract) ||
		len(ast.GetImplementsHeritageClauseElements(node)) != 0
}

// errorHead returns where an error declaration's keyword starts, schema for
// a schema error, and where its head ends: after the name or the type
// parameters.
func (p *projector) errorHead(node *ast.Node) (int, int, bool) {
	class := node.AsClassDeclaration()
	name := class.Name()
	start, ok := p.keywordBefore(name, "error")
	if !ok {
		return 0, 0, false
	}
	if errorClassFormOf(node) == errorClassSchemaRoot || errorClassFormOf(node) == errorClassSchemaSubclass {
		before := strings.TrimRight(p.text[:start], " \t")
		if !strings.HasSuffix(before, "schema") {
			return 0, 0, false
		}
		start = len(before) - len("schema")
	}
	head := name.End()
	if class.TypeParameters != nil {
		closing := scanner.SkipTrivia(p.text, class.TypeParameters.End())
		if closing >= len(p.text) || p.text[closing] != '>' {
			return 0, 0, false
		}
		head = closing + 1
	}
	return start, head, true
}

// errorBodyOpen returns the position after an error declaration's opening
// brace, or -1 when it has no body.
func (p *projector) errorBodyOpen(node *ast.Node, after int) int {
	at := scanner.SkipTrivia(p.text, after)
	for at < node.End() {
		if p.text[at] == '{' {
			return at + 1
		}
		at = scanner.SkipTrivia(p.text, at+1)
	}
	return -1
}

// errorField makes the field whose name is name a declare member, readonly
// unless written mutable or already readonly.
func (p *projector) errorField(name *ast.Node) {
	nameStart := p.tokenStart(name)
	if (ast.IsIdentifier(name) || ast.IsStringLiteral(name)) && name.Text() == "constructor" {
		// A class field cannot use constructor as an identifier. The
		// computed spelling keeps the same payload key in virtual TypeScript.
		prefix := "declare readonly "
		if start, ok := p.keywordBefore(name, "mutable"); ok {
			p.plan.replace(start, start+len("mutable"), "declare")
			prefix = ""
		} else if start, ok := p.keywordBefore(name, "readonly"); ok {
			p.plan.insert(start, "declare ")
			prefix = ""
		}
		p.plan.replace(nameStart, name.End(), prefix+"[\"constructor\"]")
		return
	}
	if start, ok := p.keywordBefore(name, "mutable"); ok {
		p.plan.replace(start, start+len("mutable"), "declare")
		return
	}
	if start, ok := p.keywordBefore(name, "readonly"); ok {
		p.plan.insert(start, "declare ")
		return
	}
	p.plan.insert(nameStart, "declare readonly ")
}

// fieldText returns a field's text for a type literal: readonly unless
// mutable, its name, its question mark, and its type.
func (p *projector) fieldText(name *ast.Node, postfix *ast.Node, typeNode *ast.Node) string {
	text := ""
	if _, ok := p.keywordBefore(name, "mutable"); !ok {
		text = "readonly "
	}
	text += p.text[p.tokenStart(name):name.End()]
	if postfix != nil {
		text += "?"
	}
	return text + ": " + p.text[p.tokenStart(typeNode):typeNode.End()] + "; "
}

// errorClassDeclaration projects an error declaration written with a class's
// features, or a schema error.
func (p *projector) errorClassDeclaration(node *ast.Node) {
	form := errorClassFormOf(node)
	class := node.AsClassDeclaration()
	name := class.Name()
	start, head, ok := p.errorHead(node)
	if !ok {
		p.unprojected(node)
		return
	}
	if class.TypeParameters != nil {
		p.visitList(class.TypeParameters.Nodes, env{})
	}
	abstract := ast.HasSyntacticModifier(node, ast.ModifierFlagsAbstract)
	self := name.Text()
	if class.TypeParameters != nil {
		var parameters []string
		for _, parameter := range class.TypeParameters.Nodes {
			parameters = append(parameters, parameter.Name().Text())
		}
		self += "<" + strings.Join(parameters, ", ") + ">"
	}
	extends := ast.GetClassExtendsHeritageElement(node)
	quoted := strconv.Quote(name.Text())
	open := p.errorBodyOpen(node, head)
	var bodyStart []string // members written after the opening brace
	switch form {
	case errorClassRoot:
		p.plan.replace(start, start+len("error"), "class")
		fields := extends.TypeArguments()[0]
		tag := quoted
		literal := "{ "
		if fields.Flags&ast.NodeFlagsReparsed == 0 {
			for _, member := range fields.Members() {
				literal += p.fieldText(member.Name(), member.PostfixToken(), member.Type())
				if member.Name().Text() == "_tag" {
					tag += " as " + p.text[p.tokenStart(member.Type()):member.Type().End()]
				}
				p.errorField(member.Name())
				p.visit(member.Type(), env{})
			}
		}
		if abstract && !strings.Contains(tag, " as ") {
			tag += " as string"
		}
		p.plan.insert(head, " extends "+p.names.prelude("TaggedError")+"("+tag+")<"+literal+"}>")
	case errorClassSubclass:
		p.plan.replace(start, start+len("error"), "class")
		base := extends.Expression().Arguments()[0]
		p.plan.insert(p.tokenStart(base), helperRef("$errorSubclass")+"(")
		p.visit(base, env{})
		p.plan.insert(base.End(), ", "+quoted+")")
		p.visitList(extends.TypeArguments(), env{})
		var fields []string
		hasConstructor := false
		for _, member := range class.Members.Nodes {
			switch {
			case member.Kind == ast.KindPropertyDeclaration && member.Flags&ast.NodeFlagsReparsed != 0:
				// The parser's tag: declare readonly _tag: "Name".
				tagType := quoted
				if abstract {
					tagType = "string"
				}
				bodyStart = append(bodyStart, "declare readonly _tag: "+tagType+";")
			case member.Kind == ast.KindConstructor && member.Flags&ast.NodeFlagsReparsed != 0:
			case member.Kind == ast.KindPropertyDeclaration && hasSynthesizedDeclare(member):
				p.errorField(member.Name())
				p.visit(member.Type(), env{})
				if member.Name().Text() != "_tag" {
					fields = append(fields, strconv.Quote(member.Name().Text()))
				}
			default:
				if member.Kind == ast.KindConstructor {
					hasConstructor = true
				}
				p.visit(member, env{})
			}
		}
		if len(fields) != 0 && !hasConstructor {
			baseText := p.text[p.tokenStart(base):base.End()]
			if arguments := extends.TypeArguments(); len(arguments) != 0 {
				// typeof Base<number>: what the instantiated base takes (D278).
				baseText += "<" + p.text[p.tokenStart(arguments[0]):arguments[len(arguments)-1].End()] + ">"
			}
			bodyStart = append(bodyStart, "constructor(args: "+helperRef("$ErrorArgs")+"<typeof "+baseText+", Pick<"+self+", "+strings.Join(fields, " | ")+">>) { super(args) }")
		}
	case errorClassSchemaRoot, errorClassSchemaSubclass:
		schema := p.names.prelude("Schema")
		call := extends.Expression()
		var tag *ast.Node
		var object *ast.Node
		if form == errorClassSchemaRoot {
			tag, object = call.Arguments()[0], call.Arguments()[1]
		} else {
			object = call.Arguments()[0]
			if properties := object.AsObjectLiteralExpression().Properties.Nodes; len(properties) != 0 {
				tag = properties[0].Initializer().Arguments()[0]
			}
		}
		tagText := quoted
		if tag != nil && tag.Kind == ast.KindAsExpression {
			typeNode := tag.AsAsExpression().Type
			if typeNode.Flags&ast.NodeFlagsReparsed != 0 {
				tagText += " as string"
			} else {
				tagText += " as " + p.text[p.tokenStart(typeNode):typeNode.End()]
				// The _tag field's own text stays a declare member.
				if at := strings.LastIndex(p.text[:p.tokenStart(typeNode)], "_tag"); at >= 0 {
					p.plan.insert(at, "declare readonly ")
				}
			}
		}
		var schemas []string
		for _, property := range object.AsObjectLiteralExpression().Properties.Nodes {
			key := property.Name()
			if key.Flags&ast.NodeFlagsReparsed != 0 {
				continue // a subclass's _tag
			}
			schemas = append(schemas, p.text[p.tokenStart(key):key.End()]+": "+p.schemaExpression(property.Initializer(), schema))
			p.errorField(key)
		}
		fields := "{ " + strings.Join(schemas, ", ") + " }"
		if form == errorClassSchemaRoot {
			p.plan.replace(start, name.Pos(), "class")
			p.plan.insert(head, " extends "+schema+".TaggedError<"+self+">()("+tagText+", "+fields+")")
		} else {
			p.plan.replace(start, name.Pos(), "class")
			base := p.extendBase(call)
			p.visit(base, env{})
			if len(schemas) != 0 {
				fields = "{ _tag: " + schema + ".tag(" + tagText + "), " + strings.Join(schemas, ", ") + " }"
			} else {
				fields = "{ _tag: " + schema + ".tag(" + tagText + ") }"
			}
			p.plan.insert(base.End(), ".extend<"+self+">("+quoted+")("+fields+")")
		}
		for _, member := range class.Members.Nodes {
			if member.Kind == ast.KindClassStaticBlockDeclaration && member.Flags&ast.NodeFlagsReparsed != 0 {
				continue // the family's static block
			}
			p.visit(member, env{})
		}
	}
	if form == errorClassRoot {
		for _, member := range class.Members.Nodes {
			p.visit(member, env{})
		}
	}
	for _, clause := range ast.GetImplementsHeritageClauseElements(node) {
		p.visit(clause, env{})
	}
	if len(bodyStart) != 0 {
		text := " " + strings.Join(bodyStart, " ")
		if open < 0 {
			p.plan.insert(node.End(), " {"+text+" }")
		} else {
			p.plan.insert(open, text)
		}
	} else if open < 0 {
		p.plan.insert(node.End(), " {}")
	}
}

// extendBase returns the base expression of a schema error subclass's
// Base.extend<Name>("Name")(...) call.
func (p *projector) extendBase(call *ast.Node) *ast.Node {
	return call.Expression().Expression().Expression()
}

// hasSynthesizedDeclare reports whether member, a subclass's field, has the
// declare modifier the parser gives a field.
func hasSynthesizedDeclare(member *ast.Node) bool {
	for _, modifier := range member.ModifierNodes() {
		if modifier.Kind == ast.KindDeclareKeyword && modifier.Flags&ast.NodeFlagsReparsed != 0 {
			return true
		}
	}
	return false
}
