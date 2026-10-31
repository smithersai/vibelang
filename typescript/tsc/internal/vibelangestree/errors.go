package vibelangestree

import (
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// Error declarations written with a class's features (D278) and schema
// errors (D279) convert as the class their source reads as: the extends
// clause names the base error, the fields are properties, and every other
// member is what it is in TypeScript. The parser keeps neither the written
// base of a subclass in its own place nor a schema error's field types, so
// errorClassSource parses the declaration again at the same offsets with its
// keyword written class, as schemaBody does for a schema declaration's
// fields. An error with fields alone keeps errorBody's conversion.

// errorSource is an error declaration parsed again as the class its source
// reads as.
type errorSource struct {
	class   *ast.Node
	text    string       // the source text with the declaration's VibeLang words blanked
	fields  map[int]bool // the start of each field's name: whether it is readonly
	start   int          // where the declaration's keyword starts, schema for a schema error
	hasBody bool
}

// errorClassSource returns the class that n, an error declaration written
// with a class's features or a schema error, reads as, or nil for any other
// class.
func (c *converter) errorClassSource(n *ast.Node) *errorSource {
	if !c.vibe || n.Kind != ast.KindClassDeclaration || n.Name() == nil {
		return nil
	}
	mutable := c.errorClassMutableFields(n)
	if mutable == nil {
		return nil
	}
	after := n.Pos()
	if mods := n.ModifierNodes(); len(mods) != 0 {
		after = mods[len(mods)-1].End()
	}
	keyword, _ := c.tokenAfter(after)
	word := c.text[keyword.start:keyword.end]
	if word != "error" && word != "schema" {
		return nil
	}
	start, end := c.start(n), n.End()
	b := []byte(blank(c.text))
	copy(b[start:end], c.text[start:end])
	at := keyword.start
	if word == "schema" {
		second, _ := c.tokenAfter(keyword.end) // error
		copy(b[keyword.start:keyword.end], strings.Repeat(" ", keyword.end-keyword.start))
		at = second.start
	}
	copy(b[at:], "class")
	fields := map[int]bool{} // name start -> readonly
	for pos := range mutable {
		// mutable is the token before a mutable field's name (D134).
		name := scanSkipTrivia(c.text, pos)
		j := pos
		for j > 0 && (c.text[j-1] == ' ' || c.text[j-1] == '\t' || c.text[j-1] == '\n' || c.text[j-1] == '\r') {
			j--
		}
		if j >= len("mutable") && c.text[j-len("mutable"):j] == "mutable" {
			copy(b[j-len("mutable"):j], "       ")
		}
		fields[name] = false
	}
	text := string(b)
	hasBody := strings.HasSuffix(strings.TrimRight(c.text[start:end], " \t\r\n"), "}")
	if !hasBody {
		text = text[:end] + " {}" + text[min(len(text), end+3):]
	}
	file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/error.vibe", PathKey: "/error.vibe"}, text, core.ScriptKindTS)
	statements := listNodes(file.Statements)
	if len(file.Diagnostics()) != 0 || len(statements) != 1 || statements[0].Kind != ast.KindClassDeclaration {
		return nil
	}
	for _, member := range listNodes(statements[0].ClassLikeData().Members) {
		if isErrorField(member) {
			name := scanSkipTrivia(text, member.Name().Pos())
			if _, ok := fields[name]; !ok {
				fields[name] = true
			}
		}
	}
	return &errorSource{class: statements[0], text: text, fields: fields, start: keyword.start, hasBody: hasBody}
}

// errorClassMutableFields returns where the name of each field that n
// writes with mutable starts, right after the word, or nil when n is not an error written
// with a class's features or a schema error.
func (c *converter) errorClassMutableFields(n *ast.Node) map[int]bool {
	extends := ast.GetClassExtendsHeritageElement(n)
	if extends == nil || extends.Expression().Kind != ast.KindCallExpression {
		return nil
	}
	call := extends.Expression()
	callee := call.Expression()
	mutable := map[int]bool{}
	switch {
	case isSynthesizedIdentifier(callee, "TaggedError"):
		if len(listNodes(n.ClassLikeData().Members)) == 0 && !hasModifier(ast.KindAbstractKeyword, n) && len(ast.GetImplementsHeritageClauseElements(n)) == 0 {
			return nil // fields alone: errorBody
		}
		for _, argument := range c.typeArgumentNodes(extends.AsExpressionWithTypeArguments().TypeArguments) {
			if argument.Kind == ast.KindTypeLiteral {
				for _, member := range argument.Members() {
					if !hasModifier(ast.KindReadonlyKeyword, member) {
						mutable[member.Name().Pos()] = true
					}
				}
			}
		}
	case isSynthesizedIdentifier(callee, "$errorSubclass"):
		for _, member := range listNodes(n.ClassLikeData().Members) {
			if member.Kind == ast.KindPropertyDeclaration && !synthesized(member) && hasSynthesizedModifier(member, ast.KindDeclareKeyword) &&
				!hasModifier(ast.KindReadonlyKeyword, member) {
				mutable[member.Name().Pos()] = true
			}
		}
	case callee.Kind == ast.KindCallExpression && callee.Expression().Kind == ast.KindPropertyAccessExpression &&
		(isSynthesizedIdentifier(callee.Expression().Name(), "TaggedError") || isSynthesizedIdentifier(callee.Expression().Name(), "extend")):
		for _, argument := range call.Arguments() {
			if argument.Kind != ast.KindObjectLiteralExpression {
				continue
			}
			for _, property := range argument.AsObjectLiteralExpression().Properties.Nodes {
				if value := property.Initializer(); value != nil && value.Kind == ast.KindCallExpression &&
					value.Expression().Kind == ast.KindPropertyAccessExpression && isSynthesizedIdentifier(value.Expression().Name(), "mutableKey") {
					mutable[property.Name().Pos()] = true
				}
			}
		}
	default:
		return nil
	}
	return mutable
}

// hasSynthesizedModifier reports whether n has a modifier of kind that the
// parser wrote.
func hasSynthesizedModifier(n *ast.Node, kind ast.Kind) bool {
	for _, modifier := range n.ModifierNodes() {
		if modifier.Kind == kind && synthesized(modifier) {
			return true
		}
	}
	return false
}

// isErrorField reports whether member of an error's class is a field: a
// property with a type and no initializer whose only modifier, if any, is
// readonly, as parser/vibelang_errors.go reads it.
func isErrorField(member *ast.Node) bool {
	if member.Kind != ast.KindPropertyDeclaration || member.Initializer() != nil || member.Type() == nil ||
		member.Name().Kind == ast.KindPrivateIdentifier || member.Name().Kind == ast.KindComputedPropertyName {
		return false
	}
	for _, modifier := range member.ModifierNodes() {
		if modifier.Kind != ast.KindReadonlyKeyword {
			return false
		}
	}
	return true
}

func scanSkipTrivia(text string, pos int) int {
	for pos < len(text) {
		switch text[pos] {
		case ' ', '\t', '\n', '\r':
			pos++
			continue
		case '/':
			if pos+1 < len(text) && text[pos+1] == '/' {
				for pos < len(text) && text[pos] != '\n' {
					pos++
				}
				continue
			}
			if pos+1 < len(text) && text[pos+1] == '*' {
				if end := strings.Index(text[pos+2:], "*/"); end >= 0 {
					pos += end + 4
					continue
				}
			}
		}
		return pos
	}
	return pos
}

// errorClass converts n, an error declaration written with a class's
// features or a schema error, as the class its source reads as, or returns
// nil for any other class.
func (c *converter) errorClass(n *ast.Node) *obj {
	source := c.errorClassSource(n)
	if source == nil {
		return nil
	}
	// The reparsed class's positions are the source's, and its text differs
	// only where a VibeLang word is blanked, which a range never starts at.
	reparsed := *c
	reparsed.text = source.text
	reparsed.scan = scanner.NewScanner()
	reparsed.scan.SetText(source.text)
	result := reparsed.convertClass(source.class)
	class := result
	if result.typ() == "ExportNamedDeclaration" || result.typ() == "ExportDefaultDeclaration" {
		class, _ = result.get("declaration").(*obj)
	}
	if class == nil {
		return result
	}
	if r := class.rng(); r.start > source.start {
		// schema error: the class starts at schema, not at error.
		r.start = source.start
		class.setRange(r)
	}
	fields := source.fields
	schemaError := strings.HasPrefix(c.text[source.start:], "schema")
	body, _ := class.get("body").(*obj)
	if body != nil {
		elements, _ := body.get("body").([]any)
		for _, element := range elements {
			property, ok := element.(*obj)
			if !ok || property.typ() != "PropertyDefinition" {
				continue
			}
			if key, ok := property.get("key").(*obj); ok {
				readonly, field := fields[key.rng().start]
				if field && readonly {
					property.set("readonly", true)
				}
				if field && schemaError {
					schemaValues(property.get("typeAnnotation")) // a schema error's field reads its codec (vibelang.go)
				}
			}
		}
	}
	if !source.hasBody {
		for _, node := range []*obj{result, class} {
			r := node.rng()
			r.end = n.End()
			node.setRange(r)
		}
		class.set("body", c.nodeAt(span{n.End(), n.End()}, "ClassBody").set("body", []any{}))
	}
	return result
}
