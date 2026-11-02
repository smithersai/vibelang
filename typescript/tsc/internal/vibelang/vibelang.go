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
	"github.com/microsoft/TypeScript/tsc/internal/transformers/declarations"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

func init() {
	compiler.RegisterScriptTransformerHook(newLowering)
	compiler.RegisterDirectiveExemptSource(diagnosticSource)
	compiler.RegisterImplicitImportHook(implicitRuntimeImport)
	compiler.RegisterDeclarationTransformerHook(transformDeclarations)
	checker.RegisterCallExpressionTypeHook(callExpressionType)
	checker.RegisterReturnInferenceTargetHook(runningCallInferenceTarget)
	checker.RegisterInferredReturnTypeHook(inferredReturnType)
	checker.RegisterCallCandidateHook(callCandidate)
	checker.RegisterCandidateFilterHook(filterCandidate)
	checker.RegisterCandidateRankingHook(rankProgramCandidates)
	checker.RegisterFunctionExpressionTypeHook(functionExpressionType)
	checker.RegisterContextualReturnTypeHook(contextualReturnType)
	checker.RegisterSourceFileCheckHook(checkSourceFile)
	checker.RegisterDiagnosticsFilterHook(filterCoveredDiagnostics)
	checker.RegisterDiagnosticsFilterHook(filterPlatformImports)
	checker.RegisterClassBaseHook(classBases)
	checker.RegisterImplementedTypeHook(implementedServiceShape)
	checker.RegisterQualifiedTypeNameHook(resolveServiceShapeName)
	checker.RegisterMemberReceiverHook(memberReceiver)
	checker.RegisterCallSignaturesHook(effectValueCall)
	checker.RegisterExpressionTypeHook(returnedExpressionType)
	checker.RegisterExpressionTypeHook(expressionType)
	checker.RegisterAssertionOperandTypeHook(assertionOperandType)
	checker.RegisterCatchVariableTypeHook(catchVariableType)
	checker.RegisterUnwrappedReturnTypeHook(unwrappedReturnType)
	checker.RegisterAnnotatedReturnTypeHook(annotatedReturnType)
	checker.RegisterAnnotatedReturnInferenceHook(inferredReturnInference)
	checker.RegisterResolvingReturnTypeHook(selfCallType)
	checker.RegisterInferTypeHook(inferChannel)
	declarations.RegisterTypeAnnotationHook(hasInferredChannel)
	checker.RegisterNameResolutionHook(resolvePreludeName)
	checker.RegisterSpellingCandidatesHook(preludeSpellingCandidates)
	checker.RegisterEntityNameVisibilityHook(preludeNameVisible)
	checker.RegisterModuleNameHook(preludeModuleName)
	checker.RegisterCopiedNameHook(preludeNameUnwritten)
	checker.RegisterIteratedElementTypeHook(iteratedElementType)
}

// isVibeLangFile reports whether file is a VibeLang source file.
func isVibeLangFile(file *ast.SourceFile) bool {
	return file != nil && !file.IsDeclarationFile && file.FileName().ExtensionIs(tspath.ExtensionVibe)
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
	return ast.IsFunctionLike(node) || ast.IsClassLike(node) || node.Kind == ast.KindClassStaticBlockDeclaration
}
