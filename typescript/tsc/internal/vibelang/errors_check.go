package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
	"slices"
)

// Error declarations lower to classes that TypeScript checks normally.
// EK2117 rejects an extends clause and written _tag members or payload fields;
// the generated tag is always the error's name. Computed payload names are
// checked after their types resolve, including schema error keys.

func init() {
	fileChecks = append(fileChecks, checkErrorDeclarations)
	checker.RegisterDiagnosticsFilterHook(filterCyclicErrorConstructorDiagnostics)
}

// A cyclic base already has TS2506. Do not also expose the parser-written
// constructor parameter's recursive $ErrorArgs annotation as TS2502.
func filterCyclicErrorConstructorDiagnostics(c *checker.Checker, file *ast.SourceFile, all []*ast.Diagnostic) []*ast.Diagnostic {
	if !isVibeLangFile(file) {
		return all
	}
	var generated []core.TextRange
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if form, _ := errorFormOf(node); form == errorFormSubclass {
			for _, member := range node.ClassLikeData().Members.Nodes {
				if ast.IsConstructorDeclaration(member) && member.Flags&ast.NodeFlagsReparsed != 0 {
					for _, parameter := range member.AsConstructorDeclaration().Parameters.Nodes {
						if isSynthesizedName(parameter.Name(), "args") {
							generated = append(generated, parameter.Name().Loc)
						}
					}
				}
			}
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
	return slices.DeleteFunc(slices.Clone(all), func(d *ast.Diagnostic) bool {
		if d.Source() != "" || d.Code() != 2502 || !slices.ContainsFunc(generated, func(r core.TextRange) bool { return r.Pos() <= d.Pos() && d.End() <= r.End() }) {
			return false
		}
		return slices.ContainsFunc(all, func(primary *ast.Diagnostic) bool {
			return primary.Source() == "" && primary.Code() == 2506 && primary.Pos() == d.Pos()
		})
	})
}

// errorForm is which of the classes an error declaration writes a class is.
type errorForm int

const (
	errorFormNone           errorForm = iota
	errorFormRoot                     // error Name: TaggedError("Name")<{ fields }>
	errorFormSubclass                 // error Name extends Base: $errorSubclass(Base, "Name")
	errorFormSchemaRoot               // schema error Name: Schema.TaggedError<Name>()("Name", { fields })
	errorFormSchemaSubclass           // schema error Name extends Base: Base.extend<Name>("Name")({ fields })
)

// errorFormOf returns the form of class and, for a subclass, the expression
// that names its base.
func errorFormOf(class *ast.Node) (errorForm, *ast.Node) {
	if !ast.IsClassDeclaration(class) || class.Name() == nil {
		return errorFormNone, nil
	}
	extends := ast.GetClassExtendsHeritageElement(class)
	if extends == nil || !ast.IsCallExpression(extends.Expression()) {
		return errorFormNone, nil
	}
	call := extends.Expression()
	callee := call.Expression()
	switch {
	case isSynthesizedName(callee, "TaggedError"):
		return errorFormRoot, nil
	case isSynthesizedName(callee, "$errorSubclass") && len(call.Arguments()) == 2:
		return errorFormSubclass, call.Arguments()[0]
	case ast.IsCallExpression(callee) && ast.IsPropertyAccessExpression(callee.Expression()):
		access := callee.Expression()
		switch {
		case isSynthesizedName(access.Name(), "TaggedError") && isSynthesizedName(access.Expression(), "Schema"):
			return errorFormSchemaRoot, nil
		case isSynthesizedName(access.Name(), "extend"):
			return errorFormSchemaSubclass, access.Expression()
		}
	}
	return errorFormNone, nil
}

// isSynthesizedName reports whether node is an identifier named name that the
// parser wrote.
func isSynthesizedName(node *ast.Node, name string) bool {
	return node != nil && ast.IsIdentifier(node) && node.Flags&ast.NodeFlagsReparsed != 0 && node.Text() == name
}

func checkErrorDeclarations(c *checker.Checker, file *ast.SourceFile) {
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		if form, base := errorFormOf(node); form != errorFormNone {
			checkErrorDeclaration(c, node, form, base)
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

func checkErrorDeclaration(c *checker.Checker, class *ast.Node, form errorForm, base *ast.Node) {
	if form == errorFormRoot || form == errorFormSchemaRoot {
		reserved := checkErrorReservedMembers(c, class)
		file := ast.GetSourceFileOfNode(class)
		for _, field := range errorReservedPayloadFields(class, form) {
			if ast.IsPropertySignatureDeclaration(field) || ast.IsPropertyAssignment(field) {
				coverCodes(c, field.Name(), 2300, 2717)
			}
			reportAt(c, file, errorPayloadTagName(file, class, field), EK2117.With("The member name _tag is reserved for the error's generated tag. Rename the field, or write the explicit Effect TypeScript class to keep its contract."))
			// Cover only the synthetic tag cast/base-call failures. Keep errors
			// inside the user's type, including unknown or duplicate type names.
			coverCodes(c, field, 2345, 2352, 2769)
			reserved = true
		}
		if form == errorFormSchemaRoot && checkErrorComputedPayloadKeys(c, class) {
			reserved = true
		}
		if reserved {
			return
		}
	}
	name := class.Name()
	// VIP-13/VIP-29 reject the clause, independently of the native base's
	// tag width. The parser retains the base for independent native checks.
	if form == errorFormSubclass || form == errorFormSchemaSubclass {
		report(c, base, EK2117.With("An error declaration cannot have an extends clause. Use a union to group errors, or keep inheritance in a TypeScript class."))
		// These checks belong to the generated helper call, not to the
		// source clause that is already rejected.
		if form == errorFormSubclass {
			coverArgument(c, base)
		} else {
			cover(c, base)
		}
		coverCodes(c, name, 2345, 2416, 2554) // synthesized constructor/tag members
		coverCodes(c, class.ClassLikeData().HeritageClauses.Nodes[0], 2509)
		// The generated schema-base call can span the payload fields. Its
		// diagnostic is redundant, but errors in authored nested classes are not.
		coverExactCodes(c, ast.GetClassExtendsHeritageElement(class).Expression(), 2509)
		return
	}
	if form == errorFormRoot {
		// A computed key that resolves to _tag can reduce the generated
		// instance to never. Resolve it here so it still gets EK2117.
		arguments := ast.GetClassExtendsHeritageElement(class).TypeArguments()
		if len(arguments) == 1 && ast.IsTypeLiteralNode(arguments[0]) {
			if tag := c.GetPropertyOfType(c.GetTypeFromTypeNode(arguments[0]), "_tag"); tag != nil {
				computed := false
				for _, declaration := range tag.Declarations() {
					if declaration.Name() != nil && ast.IsComputedPropertyName(declaration.Name()) {
						computed = true
						d := report(c, declaration, EK2117.With("{0} declares a _tag field, and an error's tag is always its name, \"{0}\"."), name.Text())
						note(d, "Remove the field; use a union to group different errors.")
					}
				}
				if computed {
					coverCodes(c, name, 2509) // the generated base's conflicting tag
					return
				}
			}
		}
	}
}

// errorTagField returns the node that declares an error's tag type, its _tag
// field, or else its name.
func errorTagField(class *ast.Node, form errorForm) *ast.Node {
	switch form {
	case errorFormRoot:
		fields := ast.GetClassExtendsHeritageElement(class).TypeArguments()
		if len(fields) == 1 && ast.IsTypeLiteralNode(fields[0]) {
			for _, member := range fields[0].Members() {
				if member.Name() != nil && !ast.IsComputedPropertyName(member.Name()) && member.Name().Text() == "_tag" {
					return member
				}
			}
		}
	case errorFormSchemaRoot:
		tag := ast.GetClassExtendsHeritageElement(class).Expression().Arguments()[0]
		if tag != nil && ast.IsAsExpression(tag) && tag.Type().Flags&ast.NodeFlagsReparsed == 0 {
			return tag.Type()
		}
	}
	return class.Name()
}

// isSchemaErrorFields reports whether node is the object of field schemas
// that the parser writes for a schema error (D279), flagged NodeFlagsVibeLang.
func isSchemaErrorFields(node *ast.Node) bool {
	return ast.IsObjectLiteralExpression(node) && node.Flags&ast.NodeFlagsVibeLang != 0
}

// checkSchemaErrorFields checks the field schemas of a schema error as
// schemas.go checks a schema declaration's, and names the field whose type
// has no schema form (D279).
func checkSchemaErrorFields(c *checker.Checker, file *ast.SourceFile, fields *ast.Node) {
	for _, property := range fields.AsObjectLiteralExpression().Properties.Nodes {
		if property.Name() == nil || property.Name().Flags&ast.NodeFlagsReparsed != 0 {
			continue // the subclass's _tag: Schema.tag("Name")
		}
		value := property.Initializer()
		if isUnsupportedSchema(value) {
			loc := core.NewTextRange(scanner.SkipTrivia(file.Text(), value.Pos()), value.End())
			fieldName := nodeText(file, property.Name())
			d := reportAt(c, file, loc, EK2109.With("The field {1} has the type {0}, which has no schema form: a schema error's field is a primitive (string, number, boolean, bigint, symbol, undefined or null), a literal, a union, an array, a tuple, a Record, an object type, or another schema's name."), file.Text()[loc.Pos():loc.End()], fieldName)
			if !noteSchemaKeyword(d, file.Text()[loc.Pos():loc.End()]) {
				note(d, "Declare the error with error instead of schema error when it is never encoded, or give the field a type with a schema.")
			}
			continue
		}
		checkSchemaValue(c, file, value, fields)
	}
}

// fieldlessGeneratedErrorBase recognizes only a root error with no field
// object and no written constructor, including bases imported from .vibe.
// A written constructor remains part of the explicit TypeScript class contract.
func fieldlessGeneratedErrorBase(c *checker.Checker, base *ast.Node) bool {
	if base == nil {
		return false
	}
	symbol := c.GetSymbolAtLocation(base)
	if symbol == nil {
		return false
	}
	if symbol.Flags()&ast.SymbolFlagsAlias != 0 {
		symbol = c.GetAliasedSymbol(symbol)
	}
	if symbol == nil {
		return false
	}
	for _, decl := range symbol.Declarations() {
		form, _ := errorFormOf(decl)
		if form != errorFormRoot {
			continue
		}
		for _, member := range decl.Members() {
			if ast.IsConstructorDeclaration(member) {
				return false
			}
		}
		fields := ast.GetClassExtendsHeritageElement(decl).TypeArguments()
		if len(fields) == 1 && ast.IsTypeLiteralNode(fields[0]) {
			for _, field := range fields[0].Members() {
				if field.Name() == nil || ast.IsComputedPropertyName(field.Name()) || field.Name().Text() != "_tag" {
					return false
				}
			}
		}
		return true
	}
	return false
}

// errorPayloadTagName is the span of a reserved payload field's written
// name. A schema error's _tag field is lowered to the type of its tag
// argument, "E" as T, so its name is the property name written before that
// type's colon; the type itself is the fallback.
func errorPayloadTagName(file *ast.SourceFile, class, field *ast.Node) core.TextRange {
	text := file.Text()
	if ast.IsPropertySignatureDeclaration(field) || ast.IsPropertyAssignment(field) {
		name := field.Name()
		return core.NewTextRange(scanner.SkipTrivia(text, name.Pos()), name.End())
	}
	start := scanner.SkipTrivia(text, field.Pos())
	lower := max(0, class.Pos())
	if lower > start {
		return core.NewTextRange(start, field.End())
	}
	lex := scanner.NewScanner()
	lex.SetText(text[lower:start])
	var name core.TextRange
	found := false
	for lex.Scan() != ast.KindEndOfFile {
		if (lex.Token() == ast.KindIdentifier || lex.Token() == ast.KindStringLiteral) && lex.TokenValue() == "_tag" {
			name = core.NewTextRange(lower+lex.TokenStart(), lower+lex.TokenEnd())
			found = true
		}
	}
	if found {
		return name
	}
	return core.NewTextRange(start, field.End())
}

// errorReservedPayloadFields finds the written fields even after lowering
// moves them into the base's type argument or schema-fields object.
func errorReservedPayloadFields(class *ast.Node, form errorForm) []*ast.Node {
	var fields []*ast.Node
	base := ast.GetClassExtendsHeritageElement(class)
	switch form {
	case errorFormRoot:
		arguments := base.TypeArguments()
		if len(arguments) == 1 && ast.IsTypeLiteralNode(arguments[0]) {
			for _, field := range arguments[0].Members() {
				if errorMemberIsTag(field) {
					fields = append(fields, field)
				}
			}
		}
	case errorFormSchemaRoot:
		if tag := errorTagField(class, form); tag != class.Name() {
			fields = append(fields, tag)
		}
		arguments := base.Expression().Arguments()
		if len(arguments) > 1 && ast.IsObjectLiteralExpression(arguments[1]) {
			for _, field := range arguments[1].AsObjectLiteralExpression().Properties.Nodes {
				if field.Name() != nil && field.Name().Flags&ast.NodeFlagsReparsed == 0 && errorMemberIsTag(field) {
					fields = append(fields, field)
				}
			}
		}
	}
	return fields
}
