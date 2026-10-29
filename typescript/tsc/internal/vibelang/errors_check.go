package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
	"slices"
)

// Checks of error declarations (D278, D279, D304). An error declaration is a
// class whose base the parser writes (parser/vibelang_errors.go); TypeScript
// checks it as that class. This file reports what the class alone cannot
// say well:
//
//   - EK2117: a tag that does not fit. A concrete error's own name must fit
//     the tag type its _tag field declares, a subclass's included, since the
//     runtime tags it with that name whatever the field says; and a subclass's
//     tag must fit its base's tag type, which a family's base widens with
//     `_tag: string`. Also
//     an error that extends a class that is not an error, a schema error that
//     extends an error that is not a schema error, and an error that extends
//     a schema error.
//   - EK2118: a subclass that declares fields and no constructor, whose base's
//     constructor does not take one object of fields.

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
	name := class.Name()
	symbol := c.GetSymbolAtLocation(name)
	if symbol == nil {
		return
	}
	instance := c.GetDeclaredTypeOfSymbol(symbol)
	abstract := ast.HasSyntacticModifier(class, ast.ModifierFlagsAbstract)
	own := c.GetStringLiteralType(name.Text())
	if form == errorFormRoot || form == errorFormSchemaRoot {
		if tag := c.GetTypeOfPropertyOfType(instance, "_tag"); !abstract && tag != nil && !c.IsTypeAssignableTo(own, tag) {
			d := report(c, errorTagField(class, form), EK2117.With("{0}'s tag is \"{0}\", but its _tag field's type is {1}."), name.Text(), c.TypeToString(tag))
			note(d, "A concrete error is tagged with its own name; give _tag a type that includes it, such as string.")
		}
		return
	}
	statics := c.GetTypeAtLocation(base)
	baseName := entityText(base)
	if baseName == "" {
		baseName = nodeText(ast.GetSourceFileOfNode(base), base)
	}
	schemaBase := statics != nil && c.GetPropertyOfType(c.GetApparentType(statics), schemaTypeID) != nil
	switch {
	case form == errorFormSubclass && schemaBase:
		d := report(c, base, EK2117.With("{0} extends {1}, a schema error, so it is declared with schema error."), name.Text(), baseName)
		note(d, "Write schema error {0} extends {1}, so its fields join {1}'s schema.", name.Text(), baseName)
		cover(c, class.Name())
		return
	case form == errorFormSchemaSubclass && !schemaBase:
		report(c, base, EK2117.With("{0} is a schema error, so it extends a schema error, and {1} is not one."), name.Text(), baseName)
		cover(c, base) // TS2339: extend does not exist
		return
	}
	baseTag := errorBaseTag(c, statics)
	if baseTag == nil {
		d := report(c, base, EK2117.With("{1} is not an error, so {0} cannot extend it."), name.Text(), baseName)
		note(d, "An error extends another error, declared with error or schema error.")
		coverArgument(c, base) // TS2345: the base has no _tag
		return
	}
	tag := errorDeclaredTag(c, class, form, instance)
	if tag != nil && !c.IsTypeAssignableTo(tag, baseTag) {
		d := report(c, name, EK2117.With("{0} cannot have its own tag: {1}'s tag is {2}, which does not include {3}."), name.Text(), baseName, c.TypeToString(baseTag), c.TypeToString(tag))
		note(d, "Give {0} the field _tag: string, or declare it abstract, so that its subclasses' tags fit.", baseName)
		cover(c, name)                                           // TS2416 at the tag member the parser writes
		cover(c, class.ClassLikeData().HeritageClauses.Nodes[0]) // TS2509: a schema base whose tag reduces to never
		if field := errorTagField(class, form); field != name {
			cover(c, field)
		}
	}
	if field := errorTagField(class, form); !abstract && tag != nil && field != name && !c.IsTypeAssignableTo(own, tag) {
		d := report(c, field, EK2117.With("{0}'s tag is \"{0}\", but its _tag field's type is {1}."), name.Text(), c.TypeToString(tag))
		note(d, "A concrete error is tagged with its own name; give _tag a type that includes it, such as string.")
	}
	if form == errorFormSubclass {
		checkErrorConstructor(c, class, baseName)
	}
}

// errorBaseTag returns the tag type of the instances that statics, a base
// class's constructor type, constructs, or nil when they have no _tag.
func errorBaseTag(c *checker.Checker, statics *checker.Type) *checker.Type {
	if statics == nil {
		return nil
	}
	signatures := c.GetSignaturesOfType(statics, checker.SignatureKindConstruct)
	if len(signatures) == 0 {
		return nil
	}
	return c.GetTypeOfPropertyOfType(c.GetReturnTypeOfSignature(signatures[0]), "_tag")
}

// errorDeclaredTag returns the tag type a subclass declares: the type of the
// _tag member that the parser writes, or that the declaration's _tag field
// becomes, or, for a schema error, the type of what Schema.tag takes.
func errorDeclaredTag(c *checker.Checker, class *ast.Node, form errorForm, instance *checker.Type) *checker.Type {
	if form == errorFormSubclass {
		for _, member := range class.Members() {
			if ast.IsPropertyDeclaration(member) && member.Name() != nil && member.Name().Text() == "_tag" && member.Type() != nil {
				return c.GetTypeFromTypeNode(member.Type())
			}
		}
		return nil
	}
	if argument := schemaErrorTagArgument(class); argument != nil {
		return c.GetTypeAtLocation(argument)
	}
	return nil
}

// schemaErrorTagArgument returns what Schema.tag takes in the fields of a
// schema error subclass: "Name", or "Name" as T.
func schemaErrorTagArgument(class *ast.Node) *ast.Node {
	call := ast.GetClassExtendsHeritageElement(class).Expression()
	arguments := call.Arguments()
	if len(arguments) != 1 || !ast.IsObjectLiteralExpression(arguments[0]) {
		return nil
	}
	properties := arguments[0].AsObjectLiteralExpression().Properties.Nodes
	if len(properties) == 0 || !ast.IsPropertyAssignment(properties[0]) {
		return nil
	}
	tag := properties[0].Initializer()
	if !ast.IsCallExpression(tag) || len(tag.Arguments()) != 1 {
		return nil
	}
	return tag.Arguments()[0]
}

// errorTagField returns the node that declares an error's tag type, its _tag
// field, or else its name.
func errorTagField(class *ast.Node, form errorForm) *ast.Node {
	switch form {
	case errorFormRoot:
		fields := ast.GetClassExtendsHeritageElement(class).TypeArguments()
		if len(fields) == 1 && ast.IsTypeLiteralNode(fields[0]) {
			for _, member := range fields[0].Members() {
				if member.Name() != nil && member.Name().Text() == "_tag" {
					return member
				}
			}
		}
	case errorFormSubclass:
		for _, member := range class.Members() {
			if ast.IsPropertyDeclaration(member) && member.Flags&ast.NodeFlagsReparsed == 0 && member.Name() != nil && member.Name().Text() == "_tag" {
				return member
			}
		}
	case errorFormSchemaRoot, errorFormSchemaSubclass:
		var tag *ast.Node
		if form == errorFormSchemaRoot {
			tag = ast.GetClassExtendsHeritageElement(class).Expression().Arguments()[0]
		} else {
			tag = schemaErrorTagArgument(class)
		}
		if tag != nil && ast.IsAsExpression(tag) && tag.Type().Flags&ast.NodeFlagsReparsed == 0 {
			return tag.Type()
		}
	}
	return class.Name()
}

// checkErrorConstructor reports EK2118 when the constructor that the parser
// writes for a subclass with fields shows that its base's constructor does
// not take one object of fields (takesNoFieldObject).
func checkErrorConstructor(c *checker.Checker, class *ast.Node, baseName string) {
	if _, base := errorFormOf(class); fieldlessGeneratedErrorBase(c, base) {
		// The lowering calls super() and assigns the subclass fields. Only the
		// parser-written super(args) has this argument diagnostic.
		cover(c, class.Name())
		return
	}
	for _, member := range class.Members() {
		if !ast.IsConstructorDeclaration(member) || member.Flags&ast.NodeFlagsReparsed == 0 {
			continue
		}
		parameters := member.Parameters()
		if len(parameters) != 1 || parameters[0].Type() == nil {
			return
		}
		if t := c.GetTypeFromTypeNode(parameters[0].Type()); t != nil && takesNoFieldObject(c, t) {
			d := report(c, class.Name(), EK2118, class.Name().Text(), baseName)
			note(d, "Write a constructor for {0} that calls super with what {1} takes and sets the fields.", class.Name().Text(), baseName)
			cover(c, class.Name())
		}
		return
	}
}

// takesNoFieldObject reports whether t, the parameter type that the parser
// writes for a subclass's constructor, $ErrorArgs<typeof Base, Pick<Sub, ...>>,
// shows that the base's constructor takes no object of fields: never when it
// takes other arguments, and an intersection with a primitive or an array
// when it takes one of those, as string & Pick<Sub, "path"> does for
// constructor(raw: string). A base that takes one of several types gives a
// union, which shows it when every member does.
func takesNoFieldObject(c *checker.Checker, t *checker.Type) bool {
	switch {
	case t.Flags()&checker.TypeFlagsNever != 0:
		return true
	case t.Flags()&checker.TypeFlagsUnion != 0:
		return !slices.ContainsFunc(t.Types(), func(member *checker.Type) bool { return !takesNoFieldObject(c, member) })
	case t.Flags()&checker.TypeFlagsIntersection != 0:
		return slices.ContainsFunc(t.Types(), func(part *checker.Type) bool {
			return part.Flags()&checker.TypeFlagsPrimitive != 0 || c.IsArrayLikeType(part)
		})
	}
	return false
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
			d := reportAt(c, file, loc, EK2109.With("The field {1} has the type {0}, which has no schema form: a schema error's field is a primitive (string, number, boolean, bigint, symbol, undefined or null), a literal, a union, an array, a tuple, a Record, an object type, or another schema's name."), file.Text()[loc.Pos():loc.End()], property.Name().Text())
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
// A written constructor remains the owner's decision (EK2118).
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
				if field.Name() == nil || field.Name().Text() != "_tag" {
					return false
				}
			}
		}
		return true
	}
	return false
}
