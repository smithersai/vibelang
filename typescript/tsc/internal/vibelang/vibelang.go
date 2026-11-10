// Package vibelang compiles VibeLang (.vibe) files.
//
// VibeLang is TypeScript syntax in which every function is an Effect: a
// call to a function that returns an Effect runs it, and the compiler infers
// each function's Effect<A, E, R>. The package plugs into upstream tsc only
// through Register* hooks, which it calls from init; tsc/cmd/tsc imports it
// for that side effect. See VIBELANG.md at the repository root.
package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/pseudochecker"
	"github.com/microsoft/TypeScript/tsc/internal/transformers/declarations"
)

func init() {
	compiler.RegisterScriptTransformerHook(newEmittedRouteRewriter) // before the lowering (emitted_routes.go)
	compiler.RegisterScriptTransformerHook(newProofEraser)          // before the lowering (proofs.go)
	compiler.RegisterScriptTransformerHook(newLowering)
	compiler.RegisterDirectiveExemptSource(diagnosticSource)
	compiler.RegisterImplicitImportHook(implicitRuntimeImport)
	compiler.RegisterDeclarationTransformerHook(transformDeclarations)
	checker.RegisterCallExpressionTypeHook(callExpressionType)
	checker.RegisterReturnInferenceTargetHook(runningCallInferenceTarget)
	checker.RegisterInferredReturnTypeHook(inferredReturnType)
	checker.RegisterFunctionExpressionTypeHook(functionExpressionType)
	checker.RegisterContextualReturnTypeHook(contextualReturnType)
	checker.RegisterSourceFileCheckHook(checkSourceFile)
	checker.RegisterDiagnosticsFilterHook(filterCoveredDiagnostics)
	checker.RegisterDiagnosticsFilterHook(filterPlatformImports)
	checker.RegisterClassBaseHook(classBases)
	checker.RegisterImplementedTypeHook(implementedServiceShape)
	checker.RegisterQualifiedTypeNameHook(resolveServiceShapeName)
	checker.RegisterMemberReceiverHook(memberReceiver)
	checker.RegisterExpressionTypeHook(returnedExpressionType)
	checker.RegisterExpressionTypeHook(expressionType)
	checker.RegisterCatchVariableTypeHook(catchVariableType)
	checker.RegisterUnwrappedReturnTypeHook(unwrappedReturnType)
	checker.RegisterAnnotatedReturnTypeHook(annotatedReturnType)
	checker.RegisterGeneratorAnnotationHook(producerAnnotation)
	checker.RegisterAnnotatedReturnInferenceHook(inferredReturnInference)
	checker.RegisterResolvingReturnTypeHook(selfCallType)
	checker.RegisterInferTypeHook(inferChannel)
	declarations.RegisterTypeAnnotationHook(hasInferredChannel)
	pseudochecker.RegisterReturnTypeInferenceHook(hasInferredReturn)
	checker.RegisterNameResolutionHook(resolvePreludeName)
	checker.RegisterSpellingCandidatesHook(preludeSpellingCandidates)
	checker.RegisterEntityNameVisibilityHook(preludeNameVisible)
	checker.RegisterModuleNameHook(preludeModuleName)
	checker.RegisterCopiedNameHook(preludeNameUnwritten)
	checker.RegisterIteratedElementTypeHook(iteratedElementType)
}

// isVibeLangFile reports whether file is a VibeLang source file.
func isVibeLangFile(file *ast.SourceFile) bool {
	return file != nil && !file.IsDeclarationFile && file.IsVibeLang()
}

// isLowerable reports whether node is a function that the lowering can turn
// into an Effect: a function declaration, function expression, arrow
// function, or method with a body, declared in a .vibe file outside a
// boundary hatch's arguments, that is not async, and is not a generator
// unless it is a producer (producers.go), whose body is an Effect body too.
// Accessors and constructors stay as they are.
func isLowerable(node *ast.Node) bool {
	switch node.Kind {
	case ast.KindFunctionDeclaration, ast.KindFunctionExpression, ast.KindArrowFunction, ast.KindMethodDeclaration:
	default:
		return false
	}
	flags := ast.GetFunctionFlags(node)
	if node.Body() == nil || flags&ast.FunctionFlagsAsync != 0 || flags&ast.FunctionFlagsGenerator != 0 && !isProducer(node) {
		return false
	}
	return isVibeLangFile(ast.GetSourceFileOfNode(node)) && !inHatch(node) // a hatch's body is TypeScript (hatches.go)
}

// isFunctionBoundary reports whether node starts code that runs in a different
// function from its parent, so a call inside it cannot be run with the
// parent's yield*.
func isFunctionBoundary(node *ast.Node) bool {
	return ast.IsFunctionLike(node) || ast.IsClassLike(node) || node.Kind == ast.KindClassStaticBlockDeclaration || node.Kind == ast.KindEnumDeclaration
}

// classExtendsChild reports the part of a class that evaluates its base in
// the enclosing code. Class bodies retain their own execution boundaries.
func classExtendsChild(class, child *ast.Node) bool {
	return ast.IsClassLike(class) && ast.IsHeritageClause(child) &&
		child.AsHeritageClause().Token == ast.KindExtendsKeyword
}

// classMemberNameChild reports whether child is the computed name of a member
// of class parent, which the class evaluates where it is defined, in its
// enclosing context, as await in it suspends an enclosing async function
// (chapter 2). A decorated class keeps this context: the decorator transform
// suspends its caller for a .vibe file (estransforms/esdecorator_vibelang.go).
func classMemberNameChild(member, child *ast.Node) bool {
	return ast.IsComputedPropertyName(child) && ast.IsClassElement(member) && member.Name() == child &&
		member.Parent != nil && ast.IsClassLike(member.Parent)
}

// classDecoratorChild reports whether child is a decorator of class-like n or
// of n, a member of a class. A decorator expression runs where its class is
// defined, in its enclosing context, as await in it suspends an enclosing
// async function (chapter 2: @(try d) is allowed where @(await d) is).
func classDecoratorChild(n, child *ast.Node) bool {
	return ast.IsDecorator(child) && (ast.IsClassLike(n) || ast.IsClassElement(n) && n.Parent != nil && ast.IsClassLike(n.Parent))
}

// decoratorExpressions returns the expressions of node's decorators, in
// source order.
func decoratorExpressions(node *ast.Node) []*ast.Node {
	var out []*ast.Node
	if modifiers := node.Modifiers(); modifiers != nil {
		for _, modifier := range modifiers.Nodes {
			if ast.IsDecorator(modifier) {
				out = append(out, modifier.Expression())
			}
		}
	}
	return out
}

// classDefinitionExpressions returns what class evaluates where it is
// defined, in ECMAScript's ClassDefinitionEvaluation order: its decorators,
// its extends expression, then each member's decorators and computed name
// (classDecoratorChild, classMemberNameChild).
func classDefinitionExpressions(class *ast.Node) []*ast.Node {
	out := decoratorExpressions(class)
	if base := ast.GetClassExtendsHeritageElement(class); base != nil {
		out = append(out, base.Expression())
	}
	for _, member := range class.Members() {
		out = append(out, decoratorExpressions(member)...)
		if name := member.Name(); name != nil && classMemberNameChild(member, name) {
			out = append(out, name)
		}
	}
	return out
}

// heritageTypeArgument keeps erased class-base types outside runtime code.
// An error's payload types stay types; a schema error maps them to expressions.
func heritageTypeArgument(parent, child *ast.Node) bool {
	return ast.IsExpressionWithTypeArguments(parent) && parent.Parent != nil &&
		ast.IsHeritageClause(parent.Parent) && child != parent.Expression()
}
