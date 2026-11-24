package vibelang

import (
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// Schema services (VIP-57).
//
// schema service Stats { … } is the service Stats, checked and lowered as
// every service is, and its Rpc group, the class StatsRpcs that the parser
// writes before it (parser/vibelang_schema_service.go). The checks here are
// the ones the group needs: every member is a method that returns an Effect
// or a Stream (EK5701), and every parameter, success and error type has a
// schema form (EK2109, as a schema's field).
//
// The lowering gives the service's key class its group:
//
//	class Stats extends runtime.$schemaService("app/stats#Stats", () => StatsRpcs, ["summarize"]) {}
//
// The third argument lists the members whose error type includes Effect's
// RpcClientError: for those a transport failure is the member's typed
// failure, and for every other member it is a defect.

// EK5701 (schema-service-member): a member of a schema service that has no
// Rpc. {0} is the member, {1} why.
var EK5701 = message(5701, errorCategory, "{0} cannot be a member of a schema service: {1}.")

func init() {
	registerDiagnostic(EK5701)
	fileChecks = append(fileChecks, checkSchemaServices)
}

// siblingStatements returns the statements of the list that holds node, a
// statement.
func siblingStatements(node *ast.Node) []*ast.Node {
	parent := node.Parent
	if parent == nil {
		return nil
	}
	switch parent.Kind {
	case ast.KindSourceFile:
		return parent.AsSourceFile().Statements.Nodes
	case ast.KindBlock:
		return parent.AsBlock().Statements.Nodes
	case ast.KindModuleBlock:
		return parent.AsModuleBlock().Statements.Nodes
	case ast.KindCaseClause, ast.KindDefaultClause:
		return parent.AsCaseOrDefaultClause().Statements.Nodes
	}
	return nil
}

// schemaServiceGroup returns the Rpc group class of class, a schema service,
// or nil when class is not one.
func schemaServiceGroup(class *ast.Node) *ast.Node {
	if class == nil || !ast.IsClassDeclaration(class) || class.Name() == nil || declarationWord(class) != "service" {
		return nil
	}
	name := class.Name().Text() + parser.SchemaServiceGroupSuffix
	for _, statement := range siblingStatements(class) {
		if parser.IsSchemaServiceGroup(statement) && statement.Name() != nil && statement.Name().Text() == name {
			return statement
		}
	}
	return nil
}

// schemaServiceOf returns the service whose Rpc group is group.
func schemaServiceOf(group *ast.Node) *ast.Node {
	if !parser.IsSchemaServiceGroup(group) || group.Name() == nil {
		return nil
	}
	name := strings.TrimSuffix(group.Name().Text(), parser.SchemaServiceGroupSuffix)
	for _, statement := range siblingStatements(group) {
		if ast.IsClassDeclaration(statement) && statement != group && statement.Name() != nil && statement.Name().Text() == name && declarationWord(statement) == "service" {
			return statement
		}
	}
	return nil
}

// isSchemaService reports whether class is a schema service declaration.
func isSchemaService(class *ast.Node) bool {
	return schemaServiceGroup(class) != nil
}

// declaresSchemaService reports whether file declares a schema service.
func declaresSchemaService(file *ast.SourceFile) bool {
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		return parser.IsSchemaServiceGroup(node) || node.ForEachChild(visit)
	}
	return file.AsNode().ForEachChild(visit)
}

// schemaServiceTypedTransport returns the names of the members of class, a
// schema service, whose written error type lists Effect's RpcClientError.
func schemaServiceTypedTransport(class *ast.Node) []string {
	var names []string
	for _, member := range class.Members() {
		if !ast.IsMethodDeclaration(member) || ast.IsStatic(member) || member.Name() == nil {
			continue
		}
		if _, failure, _, ok := parser.SchemaServiceReturn(member.Type()); ok && parser.SchemaServiceDeclaresTransportError(failure) {
			names = append(names, member.Name().Text())
		}
	}
	return names
}

func checkSchemaServices(c *checker.Checker, file *ast.SourceFile) {
	if !isVibeLangFile(file) {
		return
	}
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		if parser.IsSchemaServiceGroup(node) {
			if service := schemaServiceOf(node); service != nil {
				checkSchemaService(c, file, service, node)
			}
			return false
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

// checkSchemaService checks service, a schema service whose Rpc group is
// group.
func checkSchemaService(c *checker.Checker, file *ast.SourceFile, service *ast.Node, group *ast.Node) {
	name := service.Name().Text()
	// The service's key class reads the group where the lowering writes it,
	// so a group no source names is not an unused local (TS6133).
	if symbol := group.Symbol(); symbol != nil {
		c.MarkSymbolReferenced(symbol)
	}
	if serviceShape(service) != nil {
		// schema service Name: Type has no members to read.
		d := report(c, service.Name(), EK5701.With("{0} is a schema service, so its members are written in its body: one Rpc is made from each method."), name)
		note(d, "Write schema service {0} { member(parameter: Type): Result!Error }.", name)
		return
	}
	if len(service.TypeParameters()) != 0 {
		return // EK3005
	}
	rpcs := map[string]*ast.Node{}
	for _, rpc := range parser.SchemaServiceGroupCall(group).Arguments() {
		if ast.IsCallExpression(rpc) && len(rpc.Arguments()) == 2 {
			rpcs[rpc.Arguments()[0].Text()] = rpc
		}
	}
	counts := map[string]int{}
	for _, member := range service.Members() {
		if ast.IsMethodDeclaration(member) && !ast.IsStatic(member) && member.Name() != nil && (ast.IsIdentifier(member.Name()) || ast.IsStringLiteral(member.Name())) {
			counts[member.Name().Text()]++
		}
	}
	for _, member := range service.Members() {
		if ast.IsSemicolonClassElement(member) || member.Name() == nil {
			continue
		}
		memberName := name + "." + scanner.GetTextOfNode(member.Name())
		if ast.IsStatic(member) {
			if ast.IsPropertyDeclaration(member) && member.Name().Text() == "defaultValue" {
				d := report(c, member.Name(), EK5701, memberName, "a schema service has no default value, because its implementation may be on another thread or machine")
				note(d, "Provide the default with a layer: Layer.succeed({0}, …).", name)
			}
			continue
		}
		if ast.IsAccessor(member) || serviceContractClassSyntax(member) || member.Body() != nil {
			continue // the service's own member rules report these
		}
		switch {
		case ast.IsPropertyDeclaration(member):
			if member.Initializer() != nil {
				continue // EK9207
			}
			d := report(c, member.Name(), EK5701, memberName, "it is a property, and only a call crosses the boundary")
			note(d, "Write it as a method that returns an Effect: {0}(): {1}.", scanner.GetTextOfNode(member.Name()), bangText(typeNodeText(file, member.Type()), "never", "never"))
		case ast.IsMethodDeclaration(member):
			checkSchemaServiceMethod(c, file, service, member, memberName, counts, rpcs)
		}
	}
}

// typeNodeText returns the source text of typeNode, or "Result" for none.
func typeNodeText(file *ast.SourceFile, typeNode *ast.Node) string {
	if typeNode == nil {
		return "Result"
	}
	return scanner.GetSourceTextOfNodeFromSourceFile(file, typeNode, false /*includeTrivia*/)
}

// checkSchemaServiceMethod checks member, a method of the schema service
// service.
func checkSchemaServiceMethod(c *checker.Checker, file *ast.SourceFile, service *ast.Node, member *ast.Node, memberName string, counts map[string]int, rpcs map[string]*ast.Node) {
	name := member.Name()
	if !ast.IsIdentifier(name) && !ast.IsStringLiteral(name) {
		report(c, name, EK5701, memberName, "its name is computed, and an Rpc is named by a plain member name")
		return
	}
	if counts[name.Text()] > 1 {
		d := report(c, name, EK5701, memberName, "it is overloaded, and an Rpc has one payload schema")
		note(d, "Declare one signature, with optional parameters or a union, or one member for each overload.")
		return
	}
	if parameters := member.TypeParameters(); len(parameters) != 0 {
		d := report(c, parameters[0], EK5701, memberName, "it is generic, and a type parameter has no schema")
		note(d, "Write the types the member carries, such as a schema's name.")
		return
	}
	for _, parameter := range member.Parameters() {
		if !parser.SchemaServiceParameter(parameter) {
			reason := "a destructured parameter has no name to key the payload by"
			if parameter.AsParameterDeclaration().DotDotDotToken != nil {
				reason = "a rest parameter has no single payload field"
			} else if parameter.Name() != nil && ast.IsIdentifier(parameter.Name()) {
				reason = "a this parameter is not sent"
			}
			d := report(c, parameter, EK5701, memberName, reason)
			note(d, "Give the parameter a name and a type with a schema form, such as an array.")
			return
		}
	}
	returned := member.Type()
	if returned == nil {
		cover(c, name) // TS7010: an implicit any return type
		d := report(c, name, EK5701, memberName, "it has no return type, and a schema service member returns an Effect or a Stream")
		note(d, "Write {0}.", bangText("Result", "Errors", ""))
		return
	}
	if isUnresolved(c, returned) {
		return // TypeScript reports the unresolved name
	}
	resolved := c.GetTypeFromTypeNode(returned)
	effect := isEffectType(c, resolved)
	stream := !effect && resolved != nil && c.GetPropertyOfType(resolved, streamTypeID) != nil
	_, _, writtenStream, written := parser.SchemaServiceReturn(returned)
	switch {
	case !effect && !stream:
		d := report(c, returned, EK5701, memberName, "it returns "+typeNodeText(file, returned)+", and only an Effect or a Stream crosses the boundary")
		note(d, "Write {0}, or Stream<{1}> for many values.", bangText(typeNodeText(file, returned), "never", "never"), typeNodeText(file, returned))
		return
	case !written || writtenStream != stream:
		// An alias of an Effect or Stream type: the mapping reads the
		// written channels, as a schema reads a field's written type.
		d := report(c, returned, EK5701, memberName, "its return type names its channels through "+typeNodeText(file, returned)+", and the Rpc's schemas are read from the written type")
		note(d, "Write the type out: Result!Error, or Stream<Element, Error>.")
		return
	}
	if requirements := parser.SchemaServiceRequirements(returned); requirements != nil {
		if needs := c.GetTypeFromTypeNode(requirements); needs != nil && needs.Flags()&checker.TypeFlagsNever == 0 && needs != c.GetErrorType() {
			d := report(c, requirements, EK5701, memberName, "it requires "+typeNodeText(file, requirements)+", and a caller's services do not cross the boundary")
			note(d, "Leave the requirements out; the implementation's layer gets its services where it runs.")
			return
		}
	}
	rpc := rpcs[name.Text()]
	if rpc == nil || !ast.IsObjectLiteralExpression(rpc.Arguments()[1]) {
		return
	}
	// A type's name written as the schema's value is the mapping's, not the
	// source's: EK2109 explains a name that is only a type (TS2693).
	coverCodes(c, rpc, 2693)
	for _, option := range rpc.Arguments()[1].AsObjectLiteralExpression().Properties.Nodes {
		if !ast.IsPropertyAssignment(option) || option.Name() == nil {
			continue
		}
		switch value := option.Initializer(); option.Name().Text() {
		case "payload":
			if ast.IsObjectLiteralExpression(value) {
				for _, field := range value.AsObjectLiteralExpression().Properties.Nodes {
					if ast.IsPropertyAssignment(field) {
						checkSchemaValue(c, file, field.Initializer(), rpc)
					}
				}
			}
		case "success", "error":
			checkSchemaValue(c, file, value, rpc)
		}
	}
}
