package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

func init() { fileChecks = append(fileChecks, checkForHeadCells) }

// checkForHeadCells reports the reads of a for (init; test; update) head's
// per-iteration cells that TypeScript's own checks cannot see (chapter 004,
// decided detail 240, loop round 2 OPUS-6). A binding from test or update is
// a fresh uninitialized cell in each iteration environment, which runs
// update, then test, then the body: so a read of a test binding in update is
// always a read of an uninitialized cell, TS2454, and a read of an update
// binding in update before its own pattern is a read before the binding,
// TS2448. The parser declares such a cell as a let of init marked
// NodeFlagsVibeLangIterationCell (parser.hoistForHead): CreatePerIterationEnvironment
// copies that let forward, which would let TypeScript see the previous
// iteration's value where the specification has none. A read inside a
// function created in update is a closure's and is left to run time.
func checkForHeadCells(c *checker.Checker, file *ast.SourceFile) {
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		if ast.IsForStatement(node) {
			if incrementor := node.AsForStatement().Incrementor; incrementor != nil {
				checkIterationCellReads(c, file, incrementor)
			}
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

func checkIterationCellReads(c *checker.Checker, file *ast.SourceFile, incrementor *ast.Node) {
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		if ast.IsFunctionLike(node) {
			return false
		}
		if !ast.IsIdentifier(node) || node.Flags&ast.NodeFlagsReparsed != 0 || isPlainAssignmentTarget(node) {
			return node.ForEachChild(visit)
		}
		symbol := c.GetSymbolAtLocation(node)
		if symbol == nil || symbol.ValueDeclaration() == nil {
			return false
		}
		declaration := symbol.ValueDeclaration()
		if !ast.IsVariableDeclaration(declaration) || declaration.Flags&ast.NodeFlagsVibeLangIterationCell == 0 || declaration.Name() == nil {
			return false
		}
		name := declaration.Name()
		at := scanner.GetErrorRangeForNode(file, node)
		switch {
		case name.Pos() >= incrementor.Pos() && name.End() <= incrementor.End():
			// An update binding: uninitialized until its own pattern runs.
			if nodeStart(file, node) < nodeStart(file, name) {
				c.AddDiagnostic(ast.NewDiagnostic(file, at, diagnostics.Block_scoped_variable_0_used_before_its_declaration, node.Text()))
			}
		case !iterationCellAssumedInitialized(c, symbol, node):
			// A test binding: the update of an iteration runs before its test.
			c.AddDiagnostic(ast.NewDiagnostic(file, at, diagnostics.Variable_0_is_used_before_being_assigned, node.Text()))
		}
		return false
	}
	visit(incrementor)
}

// iterationCellAssumedInitialized reports whether TypeScript's own
// definite-assignment check would accept a read of an uninitialized cell:
// without strictNullChecks, under a non-null assertion, or when the declared
// type is any, unknown or void or contains undefined (checker.checkIdentifier's
// assumeInitialized and containsUndefinedType tests). The read in update of a
// test binding follows the same type-dependent TS2454 check (chapter 004).
func iterationCellAssumedInitialized(c *checker.Checker, symbol *ast.Symbol, node *ast.Node) bool {
	options := c.CompilerOptions()
	if !options.GetStrictOptionValue(options.StrictNullChecks) || node.Parent != nil && ast.IsNonNullExpression(node.Parent) {
		return true
	}
	t := c.GetTypeOfSymbol(symbol)
	if t == nil || t.Flags()&(checker.TypeFlagsAnyOrUnknown|checker.TypeFlagsVoid) != 0 {
		return true
	}
	if t.Flags()&checker.TypeFlagsUnion != 0 {
		t = t.Types()[0]
	}
	return t.Flags()&checker.TypeFlagsUndefined != 0
}

// isPlainAssignmentTarget reports whether node is the left side of a plain
// assignment, which writes the name without reading it.
func isPlainAssignmentTarget(node *ast.Node) bool {
	parent := node.Parent
	return parent != nil && ast.IsBinaryExpression(parent) && parent.AsBinaryExpression().OperatorToken.Kind == ast.KindEqualsToken && parent.AsBinaryExpression().Left == node
}
