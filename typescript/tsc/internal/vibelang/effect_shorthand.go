package vibelang

import (
	"regexp"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// effect goes exactly where TypeScript allows async (VIP-39), so a function
// declaration keeps its function keyword: effect function load(id) and
// async function get(url). The parser still reads the shorthand that VIP-39
// removed, effect load(id) { … } or async get(url) { … }, as the declaration
// it was meant to be, and EK0101 reports it, with the quick fix, which
// vibelang --fix applies, that writes function before the name. A method
// keeps effect find() { … }, as TypeScript keeps async find() { … }.

func init() {
	fileChecks = append(fileChecks, checkShorthands)
	tsFormFixCodes = append(tsFormFixCodes, EK0101.Code)
	vipMigrationFixCodes = append(vipMigrationFixCodes, EK0101.Code)
	tsFormRules[EK0101.Code] = &tsFormRule{
		message: EK0101,
		find:    func(*checker.Checker, *ast.SourceFile, func(*ast.Node, *formRewrite, ...any)) {},
		plan:    shorthandRewrite,
		diagnosed: func(node *ast.Node) bool {
			return node.Parent != nil && shorthandName(ast.GetSourceFileOfNode(node), node.Parent) == node
		},
	}
	ls.RegisterCodeFixProvider(&ls.CodeFixProvider{Source: diagnosticSource, ErrorCodes: []int32{EK0101.Code}, GetCodeActions: typeScriptFormFix.GetCodeActions})
}

// checkShorthands reports EK0101 at each shorthand declaration of file.
func checkShorthands(c *checker.Checker, file *ast.SourceFile) {
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		if name := shorthandName(file, node); name != nil {
			rewrite := shorthandRewrite(c, file, name)
			d := reportAt(c, file, tsFormSpan(file, name), EK0101, shorthandModifier(node), name.Text())
			note(d, "Its quick fix writes {0}; vibelang --fix applies every such fix in the project.", rewrite.description)
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

// functionWord also serves effectMarkerEdit when offering EK0501 repairs.
var functionWord = regexp.MustCompile(`\bfunction\b`)

// shorthandName returns the name of node when node is a function declaration
// written without function, or nil.
func shorthandName(file *ast.SourceFile, node *ast.Node) *ast.Node {
	if file == nil || !ast.IsFunctionDeclaration(node) || node.Name() == nil || !isVibeLangFile(file) {
		return nil
	}
	name := node.Name()
	// Comments between export and the modifier are not a function keyword.
	// Scan the declaration head with TypeScript's trivia-aware scanner.
	s := scanner.GetScannerForSourceFile(file, nodeStart(file, node))
	for s.Token() != ast.KindEndOfFile && s.TokenStart() < name.Pos() {
		if s.Token() == ast.KindFunctionKeyword {
			return nil
		}
		s.Scan()
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

// shorthandRewrite plans EK0101's fix at name: function before it.
func shorthandRewrite(_ *checker.Checker, file *ast.SourceFile, name *ast.Node) *formRewrite {
	at := nodeStart(file, name)
	return &formRewrite{
		edits:       []sourceEdit{{at, at, "function "}},
		description: shorthandModifier(name.Parent) + " function " + name.Text(),
	}
}
