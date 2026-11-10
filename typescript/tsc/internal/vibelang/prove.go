package vibelang

import (
	"fmt"
	"slices"
	"strconv"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/printer"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

// The lowering for vibelang prove (VIP-43, Appendix F "The lowering"): for
// each module that declares a root, a TypeScript file with LemmaScript's
// //@ comments that copies every declaration the module's roots reach. The
// roots are spec functions and checked functions that hold a proof block;
// this version has no theorems yet. The lowering is a function of the
// program: two runs on one program write the same bytes.

// ProofModule is the lowering of one module.
type ProofModule struct {
	// Source is the module's path relative to the config directory, such as
	// src/count.vibe; the lowering file is Source + ".ts" in the proof
	// directory.
	Source string
	// Text is the lowering file.
	Text string
	// Roots are the module's roots, in source order.
	Roots []ProofDeclaration
	// Trusted are the trusted functions the roots reach, in output order.
	Trusted []ProofDeclaration
}

// ProofDeclaration is a declaration the lowering names in its output.
type ProofDeclaration struct {
	Name string
	File *ast.SourceFile
	Node *ast.Node
	// Line is the 1-based line of the declaration's first token.
	Line int
	// Imported is true for a trusted function from a TypeScript or
	// JavaScript file, which vibelang prove --strict refuses (rule 4319).
	Imported bool
}

// LowerProofs returns the lowering of each module of program with a root,
// in path order. configDirectory is the selected config's directory.
func LowerProofs(program *compiler.Program, c *checker.Checker, configDirectory string) []ProofModule {
	var modules []ProofModule
	for _, file := range sortedVibeFiles(program, configDirectory) {
		roots := proofRoots(c, file)
		if len(roots) == 0 {
			continue
		}
		l := &proofLowering{program: program, c: c, configDirectory: configDirectory, reached: map[*ast.Node]bool{}}
		modules = append(modules, l.module(file, roots))
	}
	return modules
}

// sortedVibeFiles returns the program's .vibe and .vibex files ordered by
// their path relative to configDirectory.
func sortedVibeFiles(program *compiler.Program, configDirectory string) []*ast.SourceFile {
	var files []*ast.SourceFile
	for _, file := range program.SourceFiles() {
		if isVibeLangFile(file) {
			files = append(files, file)
		}
	}
	slices.SortFunc(files, func(a, b *ast.SourceFile) int {
		return strings.Compare(relativeProofPath(a, configDirectory), relativeProofPath(b, configDirectory))
	})
	return files
}

// relativeProofPath is file's path relative to configDirectory, with /.
func relativeProofPath(file *ast.SourceFile, configDirectory string) string {
	return tspath.GetRelativePathFromDirectory(configDirectory, file.FileName().AsString(), tspath.CaseSensitive)
}

// proofRoots returns file's roots: its spec functions and its checked
// functions that hold a proof block, in source order.
func proofRoots(c *checker.Checker, file *ast.SourceFile) []*ast.Node {
	if !mayHoldProofForms(file) {
		return nil
	}
	var roots []*ast.Node
	for _, statement := range file.Statements.Nodes {
		if isSpecFunction(statement) && statement.Body() != nil && statement.Name() != nil {
			roots = append(roots, statement)
		} else if checkedFunction(c, statement) != nil && holdsProofBlock(statement) {
			roots = append(roots, statement)
		}
	}
	return roots
}

// HasProofRoots reports whether file declares a root.
func HasProofRoots(c *checker.Checker, file *ast.SourceFile) bool {
	return isVibeLangFile(file) && len(proofRoots(c, file)) > 0
}

// holdsProofBlock reports whether fn's body holds a proof block.
func holdsProofBlock(fn *ast.Node) bool {
	found := false
	var visit func(n *ast.Node) bool
	visit = func(n *ast.Node) bool {
		if isProofBlock(n) {
			found = true
			return true
		}
		return n.ForEachChild(visit)
	}
	fn.Body().ForEachChild(visit)
	return found
}

type proofLowering struct {
	program         *compiler.Program
	c               *checker.Checker
	configDirectory string
	reached         map[*ast.Node]bool
	order           []*ast.Node
}

// module lowers file, whose roots are roots.
func (l *proofLowering) module(file *ast.SourceFile, roots []*ast.Node) ProofModule {
	source := relativeProofPath(file, l.configDirectory)
	result := ProofModule{Source: source}
	for _, root := range roots {
		l.reach(root)
		result.Roots = append(result.Roots, l.declaration(root))
	}
	slices.SortFunc(l.order, func(a, b *ast.Node) int {
		fa, fb := ast.GetSourceFileOfNode(a), ast.GetSourceFileOfNode(b)
		if fa != fb {
			return strings.Compare(relativeProofPath(fa, l.configDirectory), relativeProofPath(fb, l.configDirectory))
		}
		return a.Pos() - b.Pos()
	})
	var text strings.Builder
	text.WriteString("// Generated by vibelang prove from " + source + ". Do not edit.\n")
	for _, node := range l.order {
		if isTrustedFunction(node) {
			result.Trusted = append(result.Trusted, l.declaration(node))
		}
		text.WriteString(l.print(node))
	}
	result.Text = text.String()
	return result
}

// declaration describes node for vibelang prove's output.
func (l *proofLowering) declaration(node *ast.Node) ProofDeclaration {
	file := ast.GetSourceFileOfNode(node)
	name := ""
	if node.Name() != nil {
		name = node.Name().Text()
	}
	return ProofDeclaration{Name: name, File: file, Node: node, Line: declarationLine(file, node), Imported: isTrustedFunction(node) && !isVibeLangFile(file)}
}

// declarationLine is the 1-based line of node's first token.
func declarationLine(file *ast.SourceFile, node *ast.Node) int {
	line, _ := scanner.GetECMALineAndUTF16CharacterOfPosition(file, scanner.SkipTrivia(file.Text(), node.Pos()))
	return line + 1
}

// isTrustedFunction reports whether node is a function a proof never checks
// (Appendix F "Trusted functions"): a declaration without a body, or a
// function of a TypeScript or JavaScript file.
func isTrustedFunction(node *ast.Node) bool {
	return node.Kind == ast.KindFunctionDeclaration && (node.Body() == nil || !isVibeLangFile(ast.GetSourceFileOfNode(node)))
}

// reach adds node and every declaration it reaches to the lowering.
func (l *proofLowering) reach(node *ast.Node) {
	if l.reached[node] {
		return
	}
	l.reached[node] = true
	l.order = append(l.order, node)
	if isTrustedFunction(node) {
		return
	}
	var visit func(n *ast.Node) bool
	visit = func(n *ast.Node) bool {
		if ast.IsIdentifier(n) && isReferenceName(n) {
			if target := l.reachedDeclaration(n); target != nil {
				l.reach(target)
			}
		}
		return n.ForEachChild(visit)
	}
	node.ForEachChild(visit)
}

// reachedDeclaration returns the declaration that id names when the
// lowering copies it: a checked, spec or trusted function, a type alias or
// interface of a VibeLang module, or a module-level const statement of one.
func (l *proofLowering) reachedDeclaration(id *ast.Node) *ast.Node {
	symbol := l.c.GetSymbolAtLocation(id)
	if symbol == nil {
		return nil
	}
	symbol = l.c.SkipAlias(symbol)
	for _, d := range symbol.Declarations() {
		file := ast.GetSourceFileOfNode(d)
		if file == nil || l.program.IsSourceFileDefaultLibrary(file.PathKey()) {
			continue
		}
		switch d.Kind {
		case ast.KindFunctionDeclaration:
			if isTrustedFunction(d) {
				if len(symbol.Declarations()) == 1 && d.Name() != nil && d.AsFunctionDeclaration().AsteriskToken == nil && !ast.HasSyntacticModifier(d, ast.ModifierFlagsAsync) {
					return d // a trusted function: one signature, not async or a generator
				}
				continue
			}
			if isSpecFunction(d) || checkedFunction(l.c, d) != nil {
				return d
			}
		case ast.KindTypeAliasDeclaration, ast.KindInterfaceDeclaration:
			if isVibeLangFile(file) && d.Parent != nil && d.Parent.Kind == ast.KindSourceFile {
				return d
			}
		case ast.KindVariableDeclaration:
			if isVibeLangFile(file) && d.Parent != nil && d.Parent.Flags&ast.NodeFlagsConst != 0 && d.Parent.Parent != nil && d.Parent.Parent.Parent != nil && d.Parent.Parent.Parent.Kind == ast.KindSourceFile {
				return d.Parent.Parent
			}
		}
	}
	return nil
}

// print returns node's text in the lowering file.
func (l *proofLowering) print(node *ast.Node) string {
	file := ast.GetSourceFileOfNode(node)
	ec := printer.NewEmitContext()
	f := ec.Factory
	switch {
	case isTrustedFunction(node):
		header := "//@ extern\n"
		if isVibeLangFile(file) {
			header += "//@ pure\n"
		}
		fn := node.AsFunctionDeclaration()
		declare := f.NewModifierList([]*ast.Node{f.NewModifier(ast.KindDeclareKeyword)})
		copied := f.UpdateFunctionDeclaration(fn, declare, fn.AsteriskToken, fn.Name(), fn.TypeParameters, fn.Parameters, fn.Type, nil /*fullSignature*/, nil /*body*/)
		return header + printProofNode(ec, copied, file) + "\n"
	case node.Kind == ast.KindFunctionDeclaration:
		return fmt.Sprintf("// %s:%d\n%s\n", relativeProofPath(file, l.configDirectory), declarationLine(file, node), l.function(ec, node))
	case node.Kind == ast.KindTypeAliasDeclaration:
		alias := node.AsTypeAliasDeclaration()
		return printProofNode(ec, f.UpdateTypeAliasDeclaration(alias, exportModifier(f), alias.Name(), alias.TypeParameters, alias.Type), file) + "\n"
	case node.Kind == ast.KindInterfaceDeclaration:
		iface := node.AsInterfaceDeclaration()
		return printProofNode(ec, f.UpdateInterfaceDeclaration(iface, exportModifier(f), iface.Name(), iface.TypeParameters, iface.HeritageClauses, iface.Members), file) + "\n"
	case node.Kind == ast.KindVariableStatement:
		statement := node.AsVariableStatement()
		return printProofNode(ec, f.UpdateVariableStatement(statement, exportModifier(f), statement.DeclarationList), file) + "\n"
	}
	return ""
}

func exportModifier(f *printer.NodeFactory) *ast.ModifierList {
	return f.NewModifierList([]*ast.Node{f.NewModifier(ast.KindExportKeyword)})
}

// printProofNode prints node without comments.
func printProofNode(ec *printer.EmitContext, node *ast.Node, file *ast.SourceFile) string {
	p := printer.NewPrinter(printer.PrinterOptions{RemoveComments: true, NewLine: core.NewLineKindLF}, printer.PrintHandlers{}, ec)
	return strings.TrimRight(p.Emit(node, file), "\n")
}

// proofPlaceholderPrefix names the statements the lowering prints in place
// of proof blocks, then replaces with //@ lines. No VibeLang identifier
// starts with it, because the printer only prints the source's names.
const proofPlaceholderPrefix = "__vibelang_proof_"

// function prints fn as an exported function whose body starts with
// //@ verify, its leading proof block's lines after it, and every other
// proof block replaced by its //@ lines.
func (l *proofLowering) function(ec *printer.EmitContext, fn *ast.Node) string {
	f := ec.Factory
	file := ast.GetSourceFileOfNode(fn)
	comments := map[string][]string{}
	placeholder := func(lines []string) *ast.Node {
		name := proofPlaceholderPrefix + strconv.Itoa(len(comments)) + "__"
		comments[name] = lines
		return f.NewExpressionStatement(f.NewIdentifier(name))
	}
	words := spelledNames(fn)
	var visitor *ast.NodeVisitor
	visitor = ec.NewNodeVisitor(func(node *ast.Node) *ast.Node {
		if isProofBlock(node) {
			lines := l.proofLines(node, fn, words)
			if isLastStatement(node) {
				lines = append(lines, "{}") // LemmaScript 0.6.6 drops a trailing //@ assert
			}
			return placeholder(lines)
		}
		return visitor.VisitEachChild(node)
	})
	body := fn.Body()
	statements := body.Statements()
	leading := []string{"//@ verify"}
	rest := statements
	for i, s := range statements {
		if ast.IsPrologueDirective(s) {
			continue
		}
		if isProofBlock(s) {
			leading = append(leading, l.proofLines(s, fn, words)...)
			rest = slices.Concat(statements[:i], statements[i+1:])
		}
		break
	}
	if len(rest) == 0 {
		leading = append(leading, "{}")
	}
	visited := []*ast.Node{placeholder(leading)}
	for _, s := range rest {
		visited = append(visited, visitor.VisitNode(s))
	}
	decl := fn.AsFunctionDeclaration()
	copied := f.UpdateFunctionDeclaration(decl, exportModifier(f), decl.AsteriskToken, decl.Name(), decl.TypeParameters, decl.Parameters, decl.Type, nil /*fullSignature*/, f.UpdateBlock(body.AsBlock(), f.NewNodeList(visited), true /*multiLine*/))
	var out strings.Builder
	for i, line := range strings.Split(printProofNode(ec, copied, file), "\n") {
		if i > 0 {
			out.WriteString("\n")
		}
		trimmed := strings.TrimSpace(line)
		if lines, ok := comments[strings.TrimSuffix(trimmed, ";")]; ok && strings.HasPrefix(trimmed, proofPlaceholderPrefix) {
			indent := line[:len(line)-len(strings.TrimLeft(line, " \t"))]
			for j, comment := range lines {
				if j > 0 {
					out.WriteString("\n")
				}
				out.WriteString(indent + comment)
			}
			continue
		}
		out.WriteString(line)
	}
	return out.String()
}

// isLastStatement reports whether no statement follows node in its list.
func isLastStatement(node *ast.Node) bool {
	if !isStatementListHome(node.Parent) {
		return true
	}
	statements := node.Parent.Statements()
	return len(statements) > 0 && statements[len(statements)-1] == node
}

// spelledNames returns the identifiers that declaration spells, which a
// quantifier's fresh index name must avoid.
func spelledNames(declaration *ast.Node) map[string]bool {
	names := map[string]bool{}
	var visit func(n *ast.Node) bool
	visit = func(n *ast.Node) bool {
		if ast.IsIdentifier(n) {
			names[n.Text()] = true
		}
		return n.ForEachChild(visit)
	}
	declaration.ForEachChild(visit)
	return names
}

// formulaEnv is what a verification expression's names print as.
type formulaEnv struct {
	// replace maps a const of a proof block to its initializer's printed
	// form, an ensures parameter to \result, and a quantifier's callback
	// parameters to R[k] and k. Symbols, not names, decide, so substitution
	// is capture-free.
	replace map[*ast.Symbol]string
	// taken are the names a fresh quantifier index must avoid.
	taken map[string]bool
}

func (e *formulaEnv) with(symbol *ast.Symbol, text string) *formulaEnv {
	next := &formulaEnv{replace: map[*ast.Symbol]string{}, taken: e.taken}
	for k, v := range e.replace {
		next.replace[k] = v
	}
	if symbol != nil {
		next.replace[symbol] = text
	}
	return next
}

// proofLines returns block's //@ lines (Appendix F "The lowering file").
func (l *proofLowering) proofLines(block *ast.Node, fn *ast.Node, words map[string]bool) []string {
	env := &formulaEnv{replace: map[*ast.Symbol]string{}, taken: words}
	return l.proofStatementLines(block.Statements(), env, nil)
}

// proofStatementLines lowers statements under the if conditions conditions.
func (l *proofLowering) proofStatementLines(statements []*ast.Node, env *formulaEnv, conditions []string) []string {
	var lines []string
	for _, statement := range statements {
		if name, ok := isProofStatement(statement); ok {
			args := statement.Expression().Arguments()
			if len(args) == 0 {
				continue
			}
			switch name {
			case "assume":
				for _, conjunct := range l.conjuncts(args[0], env) {
					lines = append(lines, "//@ requires "+conjunct)
				}
			case "invariant":
				for _, conjunct := range l.conjuncts(args[0], env) {
					lines = append(lines, "//@ invariant "+conjunct)
				}
			case "decreases":
				lines = append(lines, "//@ decreases "+l.formula(args[0], env))
			case "ensures":
				arrow := args[0]
				if arrow.Kind != ast.KindArrowFunction || len(arrow.Parameters()) != 1 {
					continue
				}
				inner := env.with(l.c.GetSymbolOfDeclaration(arrow.Parameters()[0]), `\result`)
				for _, conjunct := range l.conjuncts(arrow.Body(), inner) {
					lines = append(lines, "//@ ensures "+conjunct)
				}
			case "assert":
				if len(conditions) == 0 {
					for _, conjunct := range l.conjuncts(args[0], env) {
						lines = append(lines, "//@ assert "+conjunct)
					}
				} else {
					lines = append(lines, "//@ assert "+implication(conditions, l.formula(args[0], env)))
				}
			}
			continue
		}
		switch statement.Kind {
		case ast.KindVariableStatement:
			if declaration := proofConst(statement); declaration != nil {
				env = env.with(l.c.GetSymbolOfDeclaration(declaration), l.formula(declaration.Initializer(), env))
			}
		case ast.KindIfStatement:
			ifStatement := statement.AsIfStatement()
			condition := l.formula(ifStatement.Expression, env)
			lines = append(lines, l.proofStatementLines(blockStatements(ifStatement.ThenStatement), env, append(slices.Clone(conditions), condition))...)
			if ifStatement.ElseStatement != nil {
				lines = append(lines, l.proofStatementLines(blockStatements(ifStatement.ElseStatement), env, append(slices.Clone(conditions), "(!"+condition+")"))...)
			}
		case ast.KindBlock:
			lines = append(lines, l.proofStatementLines(statement.Statements(), env, conditions)...)
		}
	}
	return lines
}

// blockStatements returns statement's statements: a block's own, or itself.
func blockStatements(statement *ast.Node) []*ast.Node {
	if statement.Kind == ast.KindBlock {
		return statement.Statements()
	}
	return []*ast.Node{statement}
}

// implication prints C1 ==> (C2 ==> … Q).
func implication(conditions []string, conclusion string) string {
	text := conclusion
	for i := len(conditions) - 1; i >= 0; i-- {
		text = "(" + conditions[i] + " ==> " + text + ")"
	}
	return text
}

// conjuncts prints node split at its outermost &&, left to right.
func (l *proofLowering) conjuncts(node *ast.Node, env *formulaEnv) []string {
	node = ast.SkipParentheses(node)
	if ast.IsBinaryExpression(node) && node.AsBinaryExpression().OperatorToken.Kind == ast.KindAmpersandAmpersandToken {
		binary := node.AsBinaryExpression()
		return slices.Concat(l.conjuncts(binary.Left, env), l.conjuncts(binary.Right, env))
	}
	return []string{l.formula(node, env)}
}

// formula prints node, a verification expression: each operator application
// in one pair of parentheses; names, literals, member and element accesses
// and calls as written; every and some as LemmaScript's quantifiers.
func (l *proofLowering) formula(node *ast.Node, env *formulaEnv) string {
	switch node.Kind {
	case ast.KindParenthesizedExpression:
		return l.formula(node.Expression(), env)
	case ast.KindIdentifier:
		if symbol := l.c.GetSymbolAtLocation(node); symbol != nil {
			if text, ok := env.replace[symbol]; ok {
				return text
			}
		}
		return node.Text()
	case ast.KindPropertyAccessExpression:
		return l.formula(node.Expression(), env) + "." + node.Name().Text()
	case ast.KindElementAccessExpression:
		return l.formula(node.Expression(), env) + "[" + l.formula(node.AsElementAccessExpression().ArgumentExpression, env) + "]"
	case ast.KindCallExpression:
		if quantified, ok := l.quantifier(node, env); ok {
			return quantified
		}
		args := make([]string, 0, len(node.Arguments()))
		for _, arg := range node.Arguments() {
			args = append(args, l.formula(arg, env))
		}
		return l.formula(node.Expression(), env) + "(" + strings.Join(args, ", ") + ")"
	case ast.KindPrefixUnaryExpression:
		unary := node.AsPrefixUnaryExpression()
		return "(" + scanner.TokenToString(unary.Operator) + l.formula(unary.Operand, env) + ")"
	case ast.KindBinaryExpression:
		binary := node.AsBinaryExpression()
		return "(" + l.formula(binary.Left, env) + " " + scanner.TokenToString(binary.OperatorToken.Kind) + " " + l.formula(binary.Right, env) + ")"
	case ast.KindConditionalExpression:
		conditional := node.AsConditionalExpression()
		return "(" + l.formula(conditional.Condition, env) + " ? " + l.formula(conditional.WhenTrue, env) + " : " + l.formula(conditional.WhenFalse, env) + ")"
	case ast.KindArrayLiteralExpression:
		elements := make([]string, 0, len(node.Elements()))
		for _, element := range node.Elements() {
			elements = append(elements, l.formula(element, env))
		}
		return "[" + strings.Join(elements, ", ") + "]"
	case ast.KindObjectLiteralExpression:
		var properties []string
		for _, property := range node.Properties() {
			switch property.Kind {
			case ast.KindPropertyAssignment:
				properties = append(properties, property.Name().Text()+": "+l.formula(property.Initializer(), env))
			case ast.KindShorthandPropertyAssignment:
				properties = append(properties, property.Name().Text()+": "+l.formula(property.Name(), env))
			}
		}
		if len(properties) == 0 {
			return "{}"
		}
		return "{ " + strings.Join(properties, ", ") + " }"
	}
	file := ast.GetSourceFileOfNode(node)
	return file.Text()[scanner.SkipTrivia(file.Text(), node.Pos()):node.End()]
}

// quantifier prints R.every((x, i) => E) as forall(k: nat, ((k < R.length)
// ==> E”)) and R.some((x, i) => E) as exists(k: nat, ((k < R.length) &&
// E”)), with R[k] for x and k for i.
func (l *proofLowering) quantifier(call *ast.Node, env *formulaEnv) (string, bool) {
	callee := call.Expression()
	if !ast.IsPropertyAccessExpression(callee) || len(call.Arguments()) != 1 {
		return "", false
	}
	method := callee.Name().Text()
	arrow := call.Arguments()[0]
	if method != "every" && method != "some" || arrow.Kind != ast.KindArrowFunction || ast.IsBlock(arrow.Body()) {
		return "", false
	}
	parameters := arrow.Parameters()
	if len(parameters) == 0 || len(parameters) > 2 {
		return "", false
	}
	receiver := l.formula(callee.Expression(), env)
	k := ""
	for i := 0; ; i++ {
		k = "k" + strconv.Itoa(i)
		if !env.taken[k] {
			break
		}
	}
	taken := map[string]bool{}
	for name := range env.taken {
		taken[name] = true
	}
	taken[k] = true
	inner := env.with(l.c.GetSymbolOfDeclaration(parameters[0]), receiver+"["+k+"]")
	if len(parameters) == 2 {
		inner = inner.with(l.c.GetSymbolOfDeclaration(parameters[1]), k)
	}
	inner.taken = taken
	body := l.formula(arrow.Body(), inner)
	bound := "(" + k + " < " + receiver + ".length)"
	if method == "every" {
		return "forall(" + k + ": nat, (" + bound + " ==> " + body + "))", true
	}
	return "exists(" + k + ": nat, (" + bound + " && " + body + "))", true
}
