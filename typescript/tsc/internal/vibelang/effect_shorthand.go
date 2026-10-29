package vibelang

import (
	"regexp"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
)

// effect goes exactly where TypeScript allows async (VIP-39), so a function
// declaration keeps its function keyword: effect function load(id) and
// async function get(url). The parser still reads the shorthand that VIP-39
// removed, effect load(id) { … } or async get(url) { … }, as the declaration
// it was meant to be, and EK4618 reports it, with the quick fix, which
// vibelang --fix applies, that writes function before the name. A method
// keeps effect find() { … }, as TypeScript keeps async find() { … }.

// EK4618: a function declaration without its function keyword. {0} is the
// modifier, effect or async; {1} the name.
var EK4618 = message(4618, errorCategory, "{0} goes where TypeScript allows async, so a declaration keeps function: write {0} function {1}.")

func init() {
	registry[EK4618.Code] = EK4618
	fileChecks = append(fileChecks, checkShorthands)
	tsFormFixCodes = append(tsFormFixCodes, EK4618.Code)
	vipMigrationFixCodes = append(vipMigrationFixCodes, EK4618.Code)
	tsFormRules[EK4618.Code] = &tsFormRule{
		message: EK4618,
		find:    func(*checker.Checker, *ast.SourceFile, func(*ast.Node, *formRewrite, ...any)) {},
		plan:    shorthandRewrite,
		diagnosed: func(node *ast.Node) bool {
			return node.Parent != nil && shorthandName(ast.GetSourceFileOfNode(node), node.Parent) == node
		},
	}
	ls.RegisterCodeFixProvider(&ls.CodeFixProvider{Source: diagnosticSource, ErrorCodes: []int32{EK4618.Code}, GetCodeActions: typeScriptFormFix.GetCodeActions})
}

// checkShorthands reports EK4618 at each shorthand declaration of file.
func checkShorthands(c *checker.Checker, file *ast.SourceFile) {
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		if name := shorthandName(file, node); name != nil {
			rewrite := shorthandRewrite(c, file, name)
			d := reportAt(c, file, tsFormSpan(file, name), EK4618, shorthandModifier(node), name.Text())
			note(d, "Its quick fix writes {0}; vibelang --fix applies every such fix in the project.", rewrite.description)
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

var functionWord = regexp.MustCompile(`\bfunction\b`)

// shorthandName returns the name of node when node is a function declaration
// written without function, or nil.
func shorthandName(file *ast.SourceFile, node *ast.Node) *ast.Node {
	if file == nil || !ast.IsFunctionDeclaration(node) || node.Name() == nil || !isVibeLangFile(file) {
		return nil
	}
	name := node.Name()
	if functionWord.MatchString(file.Text()[nodeStart(file, node):name.Pos()]) {
		return nil
	}
	return name
}

// shorthandModifier is the word written before a shorthand declaration's
// name: effect, or async.
func shorthandModifier(fn *ast.Node) string {
	if isMarkedEffect(fn) {
		return "effect"
	}
	return "async"
}

// shorthandRewrite plans EK4618's fix at name: function before it.
func shorthandRewrite(_ *checker.Checker, file *ast.SourceFile, name *ast.Node) *formRewrite {
	at := nodeStart(file, name)
	return &formRewrite{
		edits:       []sourceEdit{{at, at, "function "}},
		description: shorthandModifier(name.Parent) + " function " + name.Text(),
	}
}
