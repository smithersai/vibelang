package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
)

// EK4843 (D498): only a function declaration named main starts when the host
// starts its module (D135), so a module whose main is a const or let that
// holds a function runs nothing, and the program prints nothing:
//
//	export const main = () => {          export function main() {
//	  Console.log("Hello")                 Console.log("Hello")
//	}                                    }
//
// It is lint, a warning like EK4830-EK4840, adjustable the same way. Its quick
// fix writes the function declaration where the function has no parameters,
// no type parameters, no name of its own, and, as an arrow, reads none of
// this, super, arguments or new.target, so the declaration means what the
// const meant, and where the variable has no type of its own. A module that
// starts its program by calling a runner at its top level draws nothing.

// EK4843: an exported const or let named main that holds a function. {0} is
// const or let.
var EK4843 = message(4843, warningCategory, "main is a {0} that holds a function, so this module never runs it: only a function declaration named main starts when the module starts.")

func init() {
	registry[EK4843.Code] = EK4843
	tsFormMessages = append(tsFormMessages, EK4843)
	tsFormFixCodes = append(tsFormFixCodes, EK4843.Code)
	tsFormRules[EK4843.Code] = &tsFormRule{
		message:   EK4843,
		find:      findConstMains,
		plan:      constMainRewrite,
		diagnosed: ast.IsIdentifier,
	}
	ls.RegisterCodeFixProvider(&ls.CodeFixProvider{Source: diagnosticSource, ErrorCodes: []int32{EK4843.Code}, GetCodeActions: typeScriptFormFix.GetCodeActions})
}

// findConstMains reports EK4843 at the name of each exported const or let
// named main at file's top level that holds a function literal without
// parameters.
func findConstMains(c *checker.Checker, file *ast.SourceFile, report func(at *ast.Node, rewrite *formRewrite, args ...any)) {
	for _, statement := range file.Statements.Nodes {
		if containsTopLevelRunner(c, statement) {
			return // the module starts its program itself
		}
	}
	for _, statement := range file.Statements.Nodes {
		if !ast.IsVariableStatement(statement) || !ast.HasSyntacticModifier(statement, ast.ModifierFlagsExport) || ast.HasSyntacticModifier(statement, ast.ModifierFlagsAmbient) {
			continue
		}
		list := statement.AsVariableStatement().DeclarationList
		for _, declaration := range list.AsVariableDeclarationList().Declarations.Nodes {
			if constMainFunction(declaration) == nil {
				continue
			}
			kind := "let"
			if list.Flags&ast.NodeFlagsBlockScoped == ast.NodeFlagsConst {
				kind = "const"
			}
			report(declaration.Name(), constMainRewrite(c, file, declaration.Name()), kind)
		}
	}
}

// constMainFunction returns the function that declaration, a variable
// declaration named main, holds: an arrow function or function expression
// without parameters, or nil.
func constMainFunction(declaration *ast.Node) *ast.Node {
	name := declaration.Name()
	if !ast.IsIdentifier(name) || name.Text() != "main" || declaration.Initializer() == nil {
		return nil
	}
	fn := ast.SkipParentheses(declaration.Initializer())
	if !ast.IsArrowFunction(fn) && !ast.IsFunctionExpression(fn) || len(fn.Parameters()) != 0 {
		return nil
	}
	return fn
}

// constMainRewrite plans EK4843's fix for name, the name of a const or let
// main: its statement becomes export function main() { … }.
func constMainRewrite(c *checker.Checker, file *ast.SourceFile, name *ast.Node) *formRewrite {
	declaration := name.Parent
	if declaration == nil || !ast.IsVariableDeclaration(declaration) {
		return nil
	}
	fn := constMainFunction(declaration)
	if fn == nil {
		return nil
	}
	list := declaration.Parent
	statement := list.Parent
	flags := ast.GetFunctionFlags(fn)
	switch {
	case len(list.AsVariableDeclarationList().Declarations.Nodes) != 1, declaration.Type() != nil:
		return &formRewrite{why: "No quick fix: write main as its own export function main() { … }, keeping what else the statement declares."}
	case fn.TypeParameters() != nil, flags&(ast.FunctionFlagsAsync|ast.FunctionFlagsGenerator) != 0, fn.Name() != nil && fn.Name().Text() != "main",
		ast.IsArrowFunction(fn) && readsLexicalContext(fn.Body()):
		return &formRewrite{why: "No quick fix: a function declaration would not mean what this function means; write export function main() { … } by hand."}
	}
	text := "export function main()"
	if t := fn.Type(); t != nil {
		text += ": " + nodeText(file, t)
	}
	if body := fn.Body(); ast.IsBlock(body) {
		text += " " + nodeText(file, body)
	} else {
		text += " {\n  return " + nodeText(file, body) + "\n}"
	}
	return &formRewrite{edits: []sourceEdit{{nodeStart(file, statement), statement.End(), text}}, description: "export function main() { … }"}
}
