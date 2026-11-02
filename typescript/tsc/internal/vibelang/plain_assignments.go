package vibelang

import (
	"strconv"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

func init() { fileChecks = append(fileChecks, checkPlainAssignments) }

// D430 applies to a function literal at every typed destination, after rule F
// converts literals.
func checkPlainAssignments(c *checker.Checker, file *ast.SourceFile) {
	a := analyzerFor(c)
	check := func(value *ast.Node, target *checker.Type) {
		if mismatch := a.plainAssignmentMismatch(value, target, nil); mismatch != nil {
			value = mismatch.value
			// Under written forms (D500) plain_targets.go reports a function
			// value, a method, and a container of either at its destination
			// (D430, D512); it leaves a function literal to its destination's
			// form, which callbacks.go checks only at a call argument. This reports
			// that literal everywhere else.
			if !isLambda(value) && !ast.IsFunctionExpression(value) {
				return
			}
			// The callback check already explains plain literal bodies and
			// named arguments whose candidate rejected their form.
			if isLambda(value) && a.finalForm(value) == formPlain && (!a.hasContract(value) || !a.canBePlain(value)) || a.finalConversion(value) == convertRejected || ast.IsMethodDeclaration(value) && !a.hasContract(value) {
				return
			}
			d := report(c, value, EK4301.With("This value contains an Effect function, but its destination expects a plain function. Write an Effect function type, or provide a plain function."))
			note(d, "The destination declares return type {0}; the source function has Effect form.", c.TypeToString(mismatch.returned))
		}
	}
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if inHatch(node) {
			return false
		}
		switch node.Kind {
		case ast.KindVariableDeclaration, ast.KindPropertyDeclaration, ast.KindParameter:
			if node.Type() != nil {
				check(node.Initializer(), c.GetTypeFromTypeNode(node.Type()))
			}
		case ast.KindBinaryExpression:
			binary := node.AsBinaryExpression()
			if binary.OperatorToken.Kind == ast.KindEqualsToken {
				target := c.GetTypeAtLocation(binary.Left)
				if ast.IsPropertyAccessExpression(binary.Left) || ast.IsElementAccessExpression(binary.Left) {
					target = a.declaredMemberType(target)
				}
				check(binary.Right, target)
			}
		case ast.KindReturnStatement:
			if fn := enclosingFunction(node); fn != nil && fn.Type() != nil {
				target := c.GetTypeFromTypeNode(fn.Type())
				if success := successType(c, target); success != nil {
					target = success
				}
				check(node.Expression(), target)
			}
		case ast.KindArrowFunction:
			if node.Type() != nil && !ast.IsBlock(node.Body()) {
				target := c.GetTypeFromTypeNode(node.Type())
				if success := successType(c, target); success != nil {
					target = success
				}
				check(node.Body(), target)
			}
			// A call's literal arguments are callbacks.go's (EK4301 for an
			// Effect-annotated callback), and its other arguments plain_targets.go's.
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

// Literals convert their immediate fields and elements; a spread converts
// the values it supplies, never the members of an object supplied as a value.
func (a *analyzer) plainAssignmentMismatch(value *ast.Node, target *checker.Type, sourceType *checker.Type) *plainRelationState {
	if value == nil || target == nil || inHatch(value) {
		return nil
	}
	c := a.checker
	value = ast.SkipParentheses(value)
	if isTypeOfDeclaration(target, value) {
		return nil // an inferred destination cannot impose a form on itself
	}
	relate := func(source, target *checker.Type) *plainRelationState {
		relation := &plainRelationState{seen: map[plainRelation]bool{}, value: value}
		if a.effectStandsForPlain(source, target, false, relation) {
			return relation
		}
		return nil
	}
	switch value.Kind {
	case ast.KindArrayLiteralExpression:
		for i, element := range value.AsArrayLiteralExpression().Elements.Nodes {
			var mismatch *plainRelationState
			if element.Kind == ast.KindSpreadElement {
				mismatch = a.plainSpreadMismatch(element.Expression(), target, true)
			} else {
				var source *checker.Type
				if sourceType != nil {
					source = c.GetTypeOfPropertyOfType(sourceType, strconv.Itoa(i))
					if source == nil {
						source = c.GetIndexTypeOfType(sourceType, c.GetNumberType())
					}
				}
				mismatch = a.plainAssignmentMismatch(element, c.GetContextualTypeForArrayLiteralAtPosition(target, value, i), source)
			}
			if mismatch != nil {
				return mismatch
			}
		}
		return nil
	case ast.KindObjectLiteralExpression:
		for _, property := range value.Properties() {
			if ast.IsSpreadAssignment(property) {
				if mismatch := a.plainSpreadMismatch(property.Expression(), target, false); mismatch != nil {
					return mismatch
				}
				continue
			}
			if name := c.GetSymbolOfDeclaration(property); name != nil {
				member := c.GetTypeOfPropertyOfType(target, name.Name())
				if member == nil {
					member = c.GetIndexTypeOfType(target, c.GetStringType())
				}
				member = a.declaredMemberType(member)
				var source *ast.Node
				switch {
				case ast.IsShorthandPropertyAssignment(property):
					source = property.Name()
				case ast.IsPropertyAssignment(property):
					source = property.Initializer()
				case ast.IsMethodDeclaration(property):
					source = property
				}
				var checked *checker.Type
				if sourceType != nil {
					checked = c.GetTypeOfPropertyOfType(sourceType, name.Name())
				}
				if mismatch := a.plainAssignmentMismatch(source, member, checked); mismatch != nil {
					return mismatch
				}
			}
		}
		return nil
	case ast.KindConditionalExpression:
		if mismatch := a.plainAssignmentMismatch(value.AsConditionalExpression().WhenTrue, target, nil); mismatch != nil {
			return mismatch
		}
		return a.plainAssignmentMismatch(value.AsConditionalExpression().WhenFalse, target, nil)
	case ast.KindBinaryExpression:
		binary := value.AsBinaryExpression()
		switch binary.OperatorToken.Kind {
		case ast.KindBarBarToken, ast.KindQuestionQuestionToken:
			if mismatch := a.plainAssignmentMismatch(binary.Left, target, nil); mismatch != nil {
				return mismatch
			}
			return a.plainAssignmentMismatch(binary.Right, target, nil)
		case ast.KindAmpersandAmpersandToken, ast.KindCommaToken:
			return a.plainAssignmentMismatch(binary.Right, target, nil)
		}
	case ast.KindSatisfiesExpression:
		return a.plainAssignmentMismatch(value.Expression(), target, nil)
	}
	if sourceType == nil {
		sourceType = c.GetTypeAtLocation(value)
	}
	return relate(sourceType, target)
}

func (a *analyzer) plainSpreadMismatch(value *ast.Node, target *checker.Type, array bool) *plainRelationState {
	c := a.checker
	source := c.GetTypeAtLocation(value)
	check := func(source, target *checker.Type) *plainRelationState {
		relation := &plainRelationState{seen: map[plainRelation]bool{}, value: value}
		if a.effectStandsForPlain(source, a.declaredMemberType(target), false, relation) {
			return relation
		}
		return nil
	}
	if !array {
		for _, property := range c.GetPropertiesOfType(target) {
			if mismatch := check(c.GetTypeOfPropertyOfType(source, property.Name()), c.GetTypeOfSymbol(property)); mismatch != nil {
				return mismatch
			}
		}
	}
	for _, index := range c.GetIndexInfosOfType(target) {
		if mismatch := check(c.GetIndexTypeOfType(source, index.KeyType()), index.ValueType()); mismatch != nil {
			return mismatch
		}
	}
	return nil
}

type plainRelation struct {
	source, target *checker.Type
	member         bool
}

type plainRelationState struct {
	value    *ast.Node
	seen     map[plainRelation]bool
	returned *checker.Type
}

func (a *analyzer) effectStandsForPlain(source, target *checker.Type, member bool, relation *plainRelationState) bool {
	seen := relation.seen
	if source == nil || target == nil || source == target || source.Flags()&(checker.TypeFlagsAny|checker.TypeFlagsNever) != 0 || target.Flags()&(checker.TypeFlagsAny|checker.TypeFlagsUnknown|checker.TypeFlagsTypeParameter) != 0 {
		return false
	}
	key := plainRelation{source, target, member}
	if seen[key] {
		return false
	}
	seen[key] = true
	defer delete(seen, key)
	c := a.checker
	if target.Flags()&checker.TypeFlagsUnion != 0 {
		matched := false
		for _, part := range target.Types() {
			if c.IsTypeAssignableTo(source, part) {
				matched = true
				if !a.effectStandsForPlain(source, part, member, relation) {
					return false
				}
			}
		}
		return matched
	}
	if source.Flags()&checker.TypeFlagsUnion != 0 {
		for _, part := range source.Types() {
			if a.effectStandsForPlain(part, target, member, relation) {
				return true
			}
		}
		return false
	}
	for _, expected := range c.GetSignaturesOfType(target, checker.SignatureKindCall) {
		returned := a.relationReturnType(expected, member)
		// An inapplicable candidate can leave a never inference placeholder;
		// TypeScript's argument error already explains that failed call.
		if returned.Flags()&checker.TypeFlagsNever != 0 || a.isExpectedEffect(returned) || a.mayBeExpectedEffect(returned) {
			continue
		}
		for _, actual := range c.GetSignaturesOfType(source, checker.SignatureKindCall) {
			fn := implementationOf(actual.Declaration())
			if fn != nil && isLowerable(fn) && !isProducer(fn) {
				if a.hasPlainContract(fn) {
					continue
				}
				if a.hasContract(fn) || a.isEffect(fn) || a.isFactory(fn) || member && a.isSplittable(fn) {
					relation.returned = returned
					return true
				}
			} else if a.isExpectedEffect(a.relationReturnType(actual, member)) {
				relation.returned = returned
				return true
			}
		}
	}
	// Compare array elements directly; library methods such as reduce have
	// their own generic declarations and do not describe held elements.
	if c.IsArrayType(target) || checker.IsTupleType(target) {
		for _, index := range c.GetIndexInfosOfType(target) {
			if a.effectStandsForPlain(c.GetIndexTypeOfType(source, index.KeyType()), index.ValueType(), true, relation) {
				return true
			}
		}
		return false
	}
	if source.Flags()&(checker.TypeFlagsObject|checker.TypeFlagsIntersection) == 0 || target.Flags()&(checker.TypeFlagsObject|checker.TypeFlagsIntersection) == 0 {
		return false
	}
	for _, property := range c.GetPropertiesOfType(target) {
		if a.effectStandsForPlain(c.GetTypeOfPropertyOfType(source, property.Name()), c.GetTypeOfSymbol(property), true, relation) {
			return true
		}
	}
	for _, index := range c.GetIndexInfosOfType(target) {
		if a.effectStandsForPlain(c.GetIndexTypeOfType(source, index.KeyType()), index.ValueType(), true, relation) {
			return true
		}
	}
	return false
}

// D492 leaves the declaring container's parameters uninstantiated on both
// sides. An extracted function value instead uses its written signature.
func (a *analyzer) relationReturnType(signature *checker.Signature, member bool) *checker.Type {
	if member {
		if declaration := signature.Declaration(); declaration != nil && declaresMemberSignature(declaration) {
			signature = a.checker.GetSignatureFromDeclaration(declaration)
		}
	}
	return a.checker.GetReturnTypeOfSignature(signature)
}

// A contextual member's form uses its declaration, while its parameters
// keep TypeScript's contextual instantiation.
func (a *analyzer) declaredMemberType(t *checker.Type) *checker.Type {
	if t == nil {
		return nil
	}
	signatures := a.checker.GetSignaturesOfType(t, checker.SignatureKindCall)
	if len(signatures) == 0 {
		return t
	}
	declared := make([]*checker.Signature, len(signatures))
	for i, signature := range signatures {
		declared[i] = a.checker.SignatureWithReturnType(signature, a.relationReturnType(signature, true))
	}
	return a.checker.NewFunctionType(nil, declared)
}

// declaresMemberSignature reports whether declaration is a member of a class,
// an interface, or a type alias's type. A generic alias of a function type,
// type LazyArg<A> = () => A, is not: TypeScript instantiates A at each use, so
// LazyArg<Effect<A, E, R>> returns an Effect, which its declaration's A,
// uninstantiated, would lose.
func declaresMemberSignature(declaration *ast.Node) bool {
	child := declaration
	for parent := declaration.Parent; parent != nil; child, parent = parent, parent.Parent {
		if parent.Kind == ast.KindTypeAliasDeclaration && parent.Type() == child {
			return false
		}
		if ast.IsClassLike(parent) || parent.Kind == ast.KindInterfaceDeclaration || parent.Kind == ast.KindTypeAliasDeclaration {
			return true
		}
		if isFunctionBoundary(parent) || parent.Kind == ast.KindSourceFile || ast.IsObjectLiteralExpression(parent) {
			return false
		}
	}
	return false
}
