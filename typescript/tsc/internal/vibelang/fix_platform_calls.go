package vibelang

import (
	"fmt"
	"path"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs"
)

// platformCallSplit moves only the platform code a wrapper's callback runs,
// the call Buffer.from(contents) or the read process.platform, into a new
// sibling TypeScript function, and calls that function where the code was.
// rewritePlatformWrappers uses it when the whole wrapper cannot move, which
// is when the callback reads a binding of the .vibe file. Each argument
// becomes a parameter of the argument's type, so the arguments are still
// evaluated in the .vibe file, in order, and only when the callback runs;
// the wrapper, Effect.try with its catch for example, stays where it was.
// It returns the overlay that writes both files, or why it cannot.
func platformCallSplit(c *checker.Checker, fs vfs.FS, file *ast.SourceFile, texts map[tspath.RootedFilePath]string, at int) (map[tspath.RootedFilePath]string, string) {
	var use *ast.Node
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		if n.Pos() <= at && at < n.End() {
			if ast.IsIdentifier(n) && nodeStart(file, n) <= at {
				use = n
			}
			n.ForEachChild(visit)
			return true
		}
		return false
	}
	file.AsNode().ForEachChild(visit)
	if use == nil {
		return nil, "no platform reference at the diagnostic"
	}
	_, top := accessChain(use)
	moved, args := top, []*ast.Node(nil)
	if parent := top.Parent; parent != nil && (ast.IsCallExpression(parent) || ast.IsNewExpression(parent)) && parent.Expression() == top {
		moved = parent
		if parent.Arguments() != nil {
			args = parent.Arguments()
		}
	}
	switch {
	case ast.IsAssignmentTarget(top) || top.Parent != nil && (ast.IsDeleteExpression(top.Parent) || ast.IsPrefixUnaryExpression(top.Parent) || ast.IsPostfixUnaryExpression(top.Parent)):
		return nil, "the platform code writes its target"
	case strings.Contains(nodeText(file, moved), "?."):
		return nil, "the platform code uses optional chaining"
	case top.Parent != nil && ast.IsTaggedTemplateExpression(top.Parent):
		return nil, "the platform code is a tagged template"
	}
	callee := nodeText(file, top)
	if strings.Contains(callee, "/*") || strings.Contains(callee, "//") {
		return nil, "the platform code has comments that cannot be moved unchanged"
	}
	// The callee must name only the host: a library or @types/node global,
	// never a binding of the .vibe file that the sibling cannot see.
	why := ""
	var root func(*ast.Node) bool
	root = func(n *ast.Node) bool {
		if ast.IsIdentifier(n) && !(n.Parent != nil && ast.IsPropertyAccessExpression(n.Parent) && n.Parent.Name() == n) {
			symbol := c.GetSymbolAtLocation(n)
			if symbol == nil || len(symbol.Declarations()) == 0 {
				why = "the platform code names " + n.Text() + ", which resolves to no host declaration"
				return true
			}
			for _, decl := range symbol.Declarations() {
				origin := ast.GetSourceFileOfNode(decl)
				if origin == nil || !(isLibFile(c, origin) || packageOf(c, origin) == "@types/node") {
					why = "the platform code names " + n.Text() + ", a binding the sibling TypeScript module cannot see"
					return true
				}
			}
		}
		return n.ForEachChild(root)
	}
	if ast.IsIdentifier(top) {
		root(top)
	} else {
		top.ForEachChild(root)
	}
	if why != "" {
		return nil, why
	}
	var params, inputs []string
	for i, arg := range args {
		if ast.IsSpreadElement(arg) {
			return nil, "the platform call spreads an argument"
		}
		text := nodeText(file, arg)
		if text == "" {
			return nil, "an argument has no source text"
		}
		name := fmt.Sprintf("arg%d", i)
		params = append(params, name+": "+c.TypeToStringEx(c.GetTypeAtLocation(arg), arg, checker.TypeFormatFlagsNoTruncation, nil))
		inputs = append(inputs, text)
	}
	start := nodeStart(file, moved)
	name := file.FileName()
	foreign, previous, companionRefusal := platformCompanion(fs, file, texts)
	stem := strings.TrimSuffix(foreign.AsString(), ".ts")
	if companionRefusal != "" {
		return nil, companionRefusal
	}
	local := (&freshNames{file: file}).freshName("$platform")
	body := callee
	if moved != top {
		names := make([]string, len(args))
		for i := range args {
			names[i] = fmt.Sprintf("arg%d", i)
		}
		body = callee + "(" + strings.Join(names, ", ") + ")"
		if ast.IsNewExpression(moved) {
			body = "new " + body
		}
	}
	helper := appendPlatformCompanion(previous, "", "export function "+local+"("+strings.Join(params, ", ")+") { return "+body+"; }\n")
	insert := nodeStart(file, file.Statements.Nodes[0])
	importPrefix := ""
	for _, statement := range file.Statements.Nodes {
		if !ast.IsExpressionStatement(statement) || !ast.IsStringLiteral(statement.Expression()) {
			break
		}
		insert, importPrefix = statement.End(), "\n"
	}
	updated := applyEdits(file.Text(), []sourceEdit{
		{insert, insert, importPrefix + "import { " + local + " } from \"./" + path.Base(stem) + ".js\";\n"},
		{start, moved.End(), local + "(" + strings.Join(inputs, ", ") + ")"},
	})
	return map[tspath.RootedFilePath]string{name: updated, foreign: helper}, ""
}
