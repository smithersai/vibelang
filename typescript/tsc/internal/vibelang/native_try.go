package vibelang

import (
	"fmt"
	"sort"
	"strconv"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// VIP-5 bans native try statements in effect code, including try/finally.
// Keep the parser's JavaScript statement priority and check the innermost
// callable's execution kind, so nested plain/async functions retain native try.
func init() {
	fileChecks = append(fileChecks, checkNativeTryStatements)
	tsFormFixCodes = append(tsFormFixCodes, EK0503.Code)
	vipMigrationFixCodes = append(vipMigrationFixCodes, EK0503.Code)
	tsFormRules[EK0503.Code] = &tsFormRule{
		message:   EK0503,
		find:      func(*checker.Checker, *ast.SourceFile, func(*ast.Node, *formRewrite, ...any)) {},
		plan:      nativeTryRewrite,
		diagnosed: ast.IsTryStatement,
	}
	ls.RegisterCodeFixProvider(&ls.CodeFixProvider{Source: diagnosticSource, ErrorCodes: []int32{EK0503.Code}, GetCodeActions: typeScriptFormFix.GetCodeActions})
}

func checkNativeTryStatements(c *checker.Checker, file *ast.SourceFile) {
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		if nativeTryInEffectCode(n) {
			d := reportAt(c, file, tsFormSpan(file, n), EK0503)
			if r := preserveRewriteComments(file, nativeTryRewrite(c, file, n)); r != nil && r.why != "" {
				note(d, r.why)
			}
		}
		return n.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

// A handler statement is represented by a TryStatement too, but is not
// native JavaScript try. Unmarked generator functions are plain (VIP-1);
// the older producer classifier must not make their native try an error.
func nativeTryInEffectCode(n *ast.Node) bool {
	if !ast.IsTryStatement(n) || isHandleStatement(n) || inHatch(n) {
		return false
	}
	file := ast.GetSourceFileOfNode(n)
	body := n.AsTryStatement().TryBlock
	if ast.NodeIsMissing(body) || body.Pos() < 0 || body.End() > len(file.Text()) {
		return false
	}
	start := nodeStart(file, body)
	if start >= len(file.Text()) || file.Text()[start] != '{' {
		return false
	} // a synthesized wrapper around a handler is not native try
	// Binding lowering also creates try/finally nodes to close iterators.
	// Only a written try keyword followed by this block is a native statement.
	keyword := nodeStart(file, n)
	if keyword < 0 || keyword+3 > len(file.Text()) || file.Text()[keyword:keyword+3] != "try" ||
		scanner.SkipTrivia(file.Text(), keyword+3) != start {
		return false
	}
	owner := effectCodeOwner(n)
	return owner != nil && (isMarkedEffect(owner) || isProgramArrow(owner) && !isCatchHandlerOf(owner) && markedForm(owner) != formNone)
}

// The migration carries abrupt completions as tagged values, then dispatches
// in the original lexical block. Moving a return into an effect block without
// this dispatch would silently continue after the original try. Local loop
// jumps stay local; leaving break/continue retain their original label.
// var hoisting, producers and retired typed/Cause clauses need separate,
// reviewed migrations and deliberately have no automatic edit.
func nativeTryRewrite(c *checker.Checker, file *ast.SourceFile, n *ast.Node) *formRewrite {
	if !nativeTryInEffectCode(n) {
		return nil
	}
	refuse := func(why string) *formRewrite { return &formRewrite{why: why} }
	if isProducer(effectCodeOwner(n)) {
		return refuse("Migrate producer yields explicitly before replacing this try statement.")
	}
	owner := effectCodeOwner(n)
	if ast.IsFunctionLike(owner) && owner.Type() == nil {
		// A mutable completion record can widen a literal-valued return.
		// Keep the original inferred API until an explicit migration supplies
		// the needed contextual type; a diagnostic-only gate cannot prove it.
		result := c.GetReturnTypeOfSignature(c.GetSignatureFromDeclaration(owner))
		if success := successType(c, result); success != nil {
			for _, member := range success.Distributed() {
				if member.Flags()&(checker.TypeFlagsStringLiteral|checker.TypeFlagsNumberLiteral|checker.TypeFlagsBigIntLiteral) != 0 {
					return refuse("Preserve the inferred literal return type explicitly before replacing this try statement.")
				}
			}
		}
	}
	for parent := n.Parent; parent != nil; parent = parent.Parent {
		if isDoArrow(file, parent) {
			return refuse("Preserve the do expression's statement completion explicitly when replacing this try statement.")
		}
		if isFunctionBoundary(parent) && !isCalledInPlace(parent) {
			break
		}
	}
	ts := n.AsTryStatement()
	if n.Flags&ast.NodeFlagsVibeLang != 0 || isCauseCatch(n) || exitBinding(ts.FinallyBlock) != nil || retiredCatchOf(file, n) != nil {
		return refuse("Migrate the retired catch or finally binding before replacing this try statement.")
	}
	var unsafe bool
	var inspect func(*ast.Node) bool
	inspect = func(node *ast.Node) bool {
		if isFunctionBoundary(node) {
			return false
		}
		if node.Kind == ast.KindSwitchStatement {
			hasDefault := false
			for _, clause := range node.AsSwitchStatement().CaseBlock.AsCaseBlock().Clauses.Nodes {
				hasDefault = hasDefault || clause.Kind == ast.KindDefaultClause
			}
			if !hasDefault {
				// A type-exhaustive switch has no syntactic default. Appending
				// a normal record would invent a fallthrough and widen A.
				unsafe = true
			}
		}
		if node != n && ast.IsTryStatement(node) && (isHandleStatement(node) || nativeTryInEffectCode(node)) || node.Kind == ast.KindYieldExpression || node.Kind == ast.KindSuperKeyword ||
			ast.IsIdentifier(node) && node.Text() == "arguments" ||
			nativeTrySourceVar(file, node) {
			unsafe = true
		}
		return node.ForEachChild(inspect)
	}
	n.ForEachChild(inspect)
	if unsafe {
		return refuse("Migrate nested try statements first; var hoisting, super, arguments, yields and switches without default require an explicit rewrite.")
	}
	if ts.FinallyBlock != nil {
		hasJump := false
		forEachJumpLeaving(ts.FinallyBlock, func(*ast.Node) { hasJump = true })
		if hasJump {
			return refuse("Move jumps out of the finalizer before replacing this try statement.")
		}
	}
	text := file.Text()
	names := map[string]bool{}
	var collectNames func(*ast.Node) bool
	collectNames = func(node *ast.Node) bool {
		if ast.IsIdentifier(node) {
			names[node.Text()] = true
		}
		return node.ForEachChild(collectNames)
	}
	file.AsNode().ForEachChild(collectNames)
	fresh := func(base string) string {
		name := base
		for i := 1; strings.Contains(text, name) || names[name]; i++ {
			name = fmt.Sprintf("%s%d", base, i)
		}
		return name
	}
	api := fresh("$nativeTryEffect")
	completion := fresh("$nativeTryCompletion")
	dispatches := []string{}
	seen := map[string]bool{}
	normal := false
	lastDispatch := ""
	validRanges := true
	block := func(b *ast.Node) string {
		if b == nil || b.Kind != ast.KindBlock || b.Pos() < 0 || b.End() > len(text) {
			validRanges = false
			return ""
		}
		open, end := nodeStart(file, b), b.End()
		if open < 0 || open >= len(text) || end <= open || end > len(text) || text[open] != '{' || text[end-1] != '}' {
			validRanges = false
			return ""
		}
		var edits []sourceEdit
		var returnedBlocks []sourceEdit
		// The parser inlines return-match (and returned do completion) into
		// a block of synthetic returns. Rewrite its original source return
		// once, rather than splicing the match keyword and each arm's range.
		var collectReturns func(*ast.Node) bool
		collectReturns = func(node *ast.Node) bool {
			if isFunctionBoundary(node) {
				return false
			}
			if node.Kind == ast.KindBlock && node.Pos() >= 0 && node.End() <= end-1 {
				from, to := nodeStart(file, node), node.End()
				if from < open+1 || from >= to {
					return false
				}
				token := scanner.GetRangeOfTokenAtPosition(file, from)
				if text[token.Pos():token.End()] == "return" {
					expression := strings.TrimSpace(text[token.End():to])
					expression = strings.TrimSuffix(expression, ";")
					edit := sourceEdit{from, to, "return { kind: \"return:\" as const, value: " + expression + "\n };"}
					returnedBlocks = append(returnedBlocks, edit)
					edits = append(edits, edit)
					if !seen["return:"] {
						seen["return:"] = true
						lastDispatch = "return " + completion + ".value;"
						dispatches = append(dispatches, "if ("+completion+".kind === \"return:\") "+lastDispatch)
					}
					return false
				}
			}
			return node.ForEachChild(collectReturns)
		}
		b.ForEachChild(collectReturns)
		forEachJumpLeaving(b, func(j *ast.Node) {
			for _, returned := range returnedBlocks {
				if j.Pos() >= returned.start && j.End() <= returned.end {
					return
				}
			}
			jumpStart := nodeStart(file, j)
			if jumpStart < open+1 || j.End() < jumpStart || j.End() > end-1 {
				validRanges = false
				return
			}
			kind := jumpKind(j.Kind)
			label := ""
			if j.Kind != ast.KindReturnStatement && j.Label() != nil {
				label = j.Label().Text()
			}
			if j.Kind == ast.KindReturnStatement && j.Expression() == nil {
				kind = "return-void"
			}
			key := kind + ":" + label
			value := ""
			dispatch := ""
			if j.Kind == ast.KindReturnStatement && j.Expression() == nil {
				dispatch = "return;"
			} else if j.Kind == ast.KindReturnStatement {
				expr := "void 0"
				if j.Expression() != nil {
					exprNode := j.Expression()
					exprStart := nodeStart(file, exprNode)
					if exprStart < jumpStart || exprNode.End() < exprStart || exprNode.End() > j.End() {
						validRanges = false
						return
					}
					before := rewriteComments.FindAllString(text[jumpStart:exprStart], -1)
					after := rewriteComments.FindAllString(text[exprNode.End():j.End()], -1)
					expr = nodeText(file, exprNode)
					if len(before) > 0 {
						expr = strings.Join(before, "\n") + "\n" + expr
					}
					if len(after) > 0 {
						expr += " " + strings.Join(after, "\n") + "\n"
					}
					if ast.IsBinaryExpression(j.Expression()) && j.Expression().AsBinaryExpression().OperatorToken.Kind == ast.KindCommaToken {
						expr = "(" + expr + ")"
					}
				}
				value = ", value: " + expr
				dispatch = "return " + completion + ".value;"
			} else {
				dispatch = kind
				if label != "" {
					dispatch += " " + label
				}
				dispatch += ";"
			}
			if !seen[key] {
				seen[key] = true
				lastDispatch = dispatch
				dispatches = append(dispatches, "if ("+completion+".kind === "+strconv.Quote(key)+") "+dispatch)
			}
			leading := ""
			if j.Kind != ast.KindReturnStatement || j.Expression() == nil {
				if comments := rewriteComments.FindAllString(text[jumpStart:j.End()], -1); len(comments) > 0 {
					leading = strings.Join(comments, "\n") + "\n"
				}
			}
			edits = append(edits, sourceEdit{jumpStart, j.End(), leading + "return { kind: " + strconv.Quote(key) + " as const" + value + " };"})
		})
		sort.Slice(edits, func(i, j int) bool { return edits[i].start > edits[j].start })
		start := open + 1
		body := text[start : end-1]
		limit := end - 1
		for _, e := range edits {
			if e.start < start || e.end < e.start || e.end > limit {
				validRanges = false
				return ""
			}
			limit = e.start
			body = body[:e.start-start] + e.text + body[e.end-start:]
		}
		// An unreachable trailing normal record would widen an explicitly returned
		// result. Omit it where the source structurally completes abruptly.
		if !nativeTryAbrupt(b) {
			normal = true
			body += "\n;return { kind: \"normal\" } as const;\n"
		}
		return "{" + body + "}"
	}
	program := "effect " + block(ts.TryBlock)
	if ts.CatchClause != nil {
		clause := ts.CatchClause.AsCatchClause()
		parameter := ""
		binding := ""
		if clause.VariableDeclaration != nil {
			name := clause.VariableDeclaration.Name()
			parameter = nodeText(file, name)
			if ast.IsBindingPattern(name) {
				binding = parameter
				parameter = fresh("$nativeTryError")
			}
		}
		handlerBody := block(clause.Block)
		if binding != "" && len(handlerBody) > 0 {
			// A native catch initializes its mutable binding in the handler.
			// Effect parameters initialize outside the cold body, so defaults
			// and computed keys that run Effects must stay in the body.
			handlerBody = "{\nlet " + binding + " = " + parameter + ";\n" + handlerBody[1:]
		}
		program = api + ".catch(" + program + ", effect (" + parameter + ") => " + handlerBody + ")"
	}
	if ts.FinallyBlock != nil {
		program = api + ".onExit(" + program + ", () => effect " + nodeText(file, ts.FinallyBlock) + ")"
	}
	if !validRanges {
		return refuse("Repair the syntax before migrating this try statement.")
	}
	if !normal && len(dispatches) > 0 {
		dispatches[len(dispatches)-1] = lastDispatch
	}
	importAt := 0
	if strings.HasPrefix(text, "#!") {
		if end := strings.IndexByte(text, '\n'); end >= 0 {
			importAt = end + 1
		}
	}
	for _, statement := range file.Statements.Nodes {
		if statement.Kind != ast.KindExpressionStatement || !ast.IsStringLiteral(statement.Expression()) {
			break
		}
		importAt = statement.End()
	}
	replacement := "{ const " + completion + " = try " + program + ";\n" + strings.Join(dispatches, "\n") + "\n}"
	return &formRewrite{
		description: "Replace the try statement with Effect catch and onExit, preserving jumps",
		edits: []sourceEdit{
			{importAt, importAt, "\nimport * as " + api + " from \"effect/Effect\";\n"},
			{nodeStart(file, n), n.End(), replacement},
		},
	}
}

// Generated declaration lists (for example resource setup) are not source var.
func nativeTrySourceVar(file *ast.SourceFile, node *ast.Node) bool {
	if node.Kind != ast.KindVariableDeclarationList || node.Flags&ast.NodeFlagsBlockScoped != 0 || node.Pos() < 0 || node.Pos() >= len(file.Text()) {
		return false
	}
	at := scanner.GetRangeOfTokenAtPosition(file, nodeStart(file, node))
	return file.Text()[at.Pos():at.End()] == "var"
}

func nativeTryAbrupt(n *ast.Node) bool {
	if n == nil {
		return false
	}
	switch n.Kind {
	case ast.KindReturnStatement, ast.KindThrowStatement, ast.KindBreakStatement, ast.KindContinueStatement:
		return true
	case ast.KindBlock:
		statements := n.AsBlock().Statements.Nodes
		for _, statement := range statements {
			if nativeTryAbrupt(statement) {
				return true
			}
		}
		return false
	case ast.KindSwitchStatement:
		// A default plus abrupt completion in every clause (including fallthrough)
		// has no normal completion. A break targeting this switch defeats that.
		localBreak := false
		var visit func(*ast.Node) bool
		visit = func(node *ast.Node) bool {
			if isFunctionBoundary(node) {
				return false
			}
			if node.Kind == ast.KindBreakStatement && node.Label() == nil {
				for parent := node.Parent; parent != nil; parent = parent.Parent {
					if parent.Kind == ast.KindSwitchStatement || ast.IsIterationStatement(parent, false) {
						if parent == n {
							localBreak = true
						}
						break
					}
				}
			}
			return node.ForEachChild(visit)
		}
		n.ForEachChild(visit)
		if localBreak {
			return false
		}
		clauses := n.AsSwitchStatement().CaseBlock.AsCaseBlock().Clauses.Nodes
		hasDefault, tailAbrupt := false, false
		for i := len(clauses) - 1; i >= 0; i-- {
			clause := clauses[i]
			if clause.Kind == ast.KindDefaultClause {
				hasDefault = true
			}
			for _, statement := range clause.AsCaseOrDefaultClause().Statements.Nodes {
				if nativeTryAbrupt(statement) {
					tailAbrupt = true
					break
				}
			}
			if !tailAbrupt {
				return false
			}
		}
		return hasDefault
	case ast.KindIfStatement:
		s := n.AsIfStatement()
		return s.ElseStatement != nil && nativeTryAbrupt(s.ThenStatement) && nativeTryAbrupt(s.ElseStatement)
	}
	return false
}
