package vibelang

import (
	"context"
	"fmt"
	"slices"
	"strconv"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

// VIP-5: replace statement catches with Effect handlers. Outward source
// jumps can cross a new function only when the whole statement is the
// enclosing Effect body's tail; other outward jumps need completion transport.
func relicTryStatementFixes(ctx context.Context, program *compiler.Program, file *ast.SourceFile, refused map[string]bool) proposal {
	result := proposal{file: file}
	if !isVibeLangFile(file) || !strings.Contains(file.Text(), "try") {
		return result
	}
	key := "try-statements:" + file.FileName().AsString()
	if refused[key] {
		return result
	}
	names := &freshNames{file: file}
	onExitAlias := names.freshName("$legacyOnExit")
	voidAlias := names.freshName("$legacyVoid")
	ensuringAlias := names.freshName("$legacyEnsuring")
	var edits []sourceEdit
	needOnExit, needVoid, needEnsuring := false, false, false
	_, forms := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: file.FileName(), PathKey: file.PathKey()}, file.Text())
	c, done := program.GetTypeCheckerForFile(ctx, file)
	defer done()
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if !ast.IsTryStatement(node) || !inEffectCode(node) {
			return node.ForEachChild(visit)
		}
		// The parser has already transported do completion into temporaries,
		// so its checker AST no longer has the written do ancestor.
		for _, form := range forms {
			if form.Kind == parser.VibeSyntaxDo && form.Open.Pos() < nodeStart(file, node) && node.End() <= form.Close.End() {
				return node.ForEachChild(visit)
			}
		}
		statement := node.AsTryStatement()
		if statement.CatchClause == nil && statement.FinallyBlock == nil {
			return node.ForEachChild(visit)
		}
		if isHandleStatement(node) {
			return node.ForEachChild(visit)
		}
		// Ordinary catch/finally statements belong to the native-try
		// migration. This codemod handles only the retired clause spellings.
		if !hasRetiredTryClause(file, node) {
			return node.ForEachChild(visit)
		}

		tail := false
		owner := enclosingFunction(node)
		if owner != nil && isDoArrow(file, owner) {
			return node.ForEachChild(visit)
		}
		if owner != nil && owner.Body() == node.Parent {
			list := owner.Body().Statements()
			tail = len(list) > 0 && list[len(list)-1] == node
		}
		safe := true
		var jumps func(*ast.Node) bool
		jumps = func(n *ast.Node) bool {
			if isFunctionBoundary(n) {
				return false
			}
			if n.Kind == ast.KindBreakStatement || n.Kind == ast.KindContinueStatement || n.Kind == ast.KindYieldExpression || ast.IsVariableDeclarationList(n) && n.Flags&ast.NodeFlagsBlockScoped == 0 {
				safe = false
			}
			if n.Kind == ast.KindReturnStatement && !tail {
				safe = false
			}
			return n.ForEachChild(jumps)
		}
		jumps(statement.TryBlock)
		if statement.CatchClause != nil {
			jumps(statement.CatchClause)
		}
		if !safe {
			return node.ForEachChild(visit)
		}
		// A surrounding do can observe a statement's completion value; a
		// callback's implicit return is not that value.
		for p := node.Parent; p != nil && p != owner; p = p.Parent {
			if isDoExpressionCall(p) || isDoArrow(file, p) {
				safe = false
				break
			}
		}
		if !safe {
			return node.ForEachChild(visit)
		}
		expression := "effect " + nodeText(file, statement.TryBlock)
		if statement.CatchClause != nil {
			if old := retiredCatchOf(file, node); old != nil {
				if old.causes {
					return node.ForEachChild(visit)
				}
				handler, ok := relicTypedCatchHandler(c, file, old)
				if !ok {
					return node.ForEachChild(visit)
				}
				expression += handler
			} else {
				clause := statement.CatchClause.AsCatchClause()
				binding := "()"
				if clause.VariableDeclaration != nil {
					if !ast.IsIdentifier(clause.VariableDeclaration.Name()) {
						return node.ForEachChild(visit)
					}
					binding = "(" + clause.VariableDeclaration.Name().Text() + ")"
				}
				expression += " catch effect " + binding + " => " + nodeText(file, clause.Block)
			}
		}
		runs := statement.CatchClause != nil
		usesOnExit, usesVoid, usesEnsuring := false, false, false
		if statement.FinallyBlock != nil {
			if !relicTryModuleVisible(c, node, "Effect") {
				return node.ForEachChild(visit)
			}
			if runs {
				expression = "effect { return (" + expression + ") }"
			}
			runs = false
			// A source finalizer cannot transfer an outward completion.
			finallySafe := true
			var finalJumps func(*ast.Node) bool
			finalJumps = func(n *ast.Node) bool {
				if isFunctionBoundary(n) {
					return false
				}
				if n.Kind == ast.KindReturnStatement || n.Kind == ast.KindBreakStatement || n.Kind == ast.KindContinueStatement {
					finallySafe = false
				}
				return n.ForEachChild(finalJumps)
			}
			finalJumps(statement.FinallyBlock)
			if !finallySafe {
				return node.ForEachChild(visit)
			}
			if binding := exitBinding(statement.FinallyBlock); binding != nil {
				if !relicTryModuleVisible(c, node, "Exit") {
					return node.ForEachChild(visit)
				}
				name := binding.Name().Text()
				open := openingBrace(file.Text(), binding.End())
				if open < 0 {
					return node.ForEachChild(visit)
				}
				body := file.Text()[open+1 : statement.FinallyBlock.End()-1]
				observed := (&freshNames{file: file}).freshName("$legacyExit")
				normalized := (&freshNames{file: file}).freshName("$legacyObserved")
				expression = onExitAlias + "((" + expression + "), effect (" + observed + ") => { const " + normalized + " = " + observed + "._tag === \"Success\" ? " + voidAlias + " : " + observed + "; { const " + name + " = " + normalized + "; " + body + "} })"
				usesOnExit, usesVoid = true, true
			} else {
				expression = ensuringAlias + "((" + expression + "), effect " + nodeText(file, statement.FinallyBlock) + ")"
				usesEnsuring = true
			}
		}
		start := nodeStart(file, node)
		{
			replacement := "(" + expression + ");"
			if !runs {
				replacement = "try " + replacement
			}
			if tail {
				replacement = "return " + replacement
			}
			if !editsPreserveComments(file.Text(), []sourceEdit{{start, node.End(), replacement}}) {
				return node.ForEachChild(visit)
			}
			edits = append(edits, sourceEdit{start, node.End(), replacement})
			needOnExit = needOnExit || usesOnExit
			needVoid = needVoid || usesVoid
			needEnsuring = needEnsuring || usesEnsuring
		}
		return false
	}
	file.AsNode().ForEachChild(visit)
	if len(edits) == 0 {
		return result
	}
	imports := ""
	if needOnExit {
		imports += "import { onExit as " + onExitAlias + " } from \"effect/Effect\";\n"
	}
	if needEnsuring {
		imports += "import { ensuring as " + ensuringAlias + " } from \"effect/Effect\";\n"
	}
	if needVoid {
		imports += "import { void as " + voidAlias + " } from \"effect/Exit\";\n"
	}
	if imports != "" {
		at, ok := relicMigrationImportPosition(file)
		if !ok {
			return result
		}
		if at > 0 && file.Text()[at-1] != '\n' && !strings.HasSuffix(file.Text()[:at], "\ufeff") {
			imports = "\n" + imports
		}
		edits = append(edits, sourceEdit{at, at, imports})
	}
	result.fixes = append(result.fixes, fileFix{label: "try statements", key: key, edits: edits})
	return result
}

func relicTryModuleVisible(c *checker.Checker, node *ast.Node, name string) bool {
	symbol := c.ResolveName(name, node, ast.SymbolFlagsValue, false)
	if symbol != nil && symbol.Flags()&ast.SymbolFlagsAlias != 0 {
		symbol = c.GetAliasedSymbol(symbol)
	}
	if symbol == nil {
		return false
	}
	for _, decl := range symbol.Declarations() {
		if ast.IsSourceFile(decl) && effectModuleOfFile(decl.AsSourceFile()) == name {
			return true
		}
	}
	return false
}

func relicTypedCatchHandler(c *checker.Checker, file *ast.SourceFile, old *retiredCatch) (string, bool) {
	main := (&freshNames{file: file}).freshName("$legacyFailure")
	text := " catch effect (" + main + ") => { "
	untyped := false
	predicates := ""
	for i, clause := range old.clauses {
		if clause.open < 0 || clause.name != nil && !ast.IsIdentifier(clause.name) {
			return "", false
		}
		if clause.typeNode == nil {
			if i != len(old.clauses)-1 {
				return "", false
			}
			untyped = true
			if i > 0 {
				text += " else "
			}
			text += "{ "
		} else {
			tags, untagged := failureTags(c, c.GetTypeFromTypeNode(clause.typeNode))
			if untagged != nil || len(tags) == 0 {
				return "", false
			}
			quoted := make([]string, len(tags))
			for j, tag := range tags {
				quoted[j] = strconv.Quote(tag)
			}
			predicate := (&freshNames{file: file}).freshName(fmt.Sprintf("$legacyMatches%d", i))
			// Use the old runtime's exact tagged-object predicate, including
			// one _tag read per clause. Class instanceof tests are different.
			predicates += "const " + predicate + " = (value: unknown): value is " + nodeText(file, clause.typeNode) + " => typeof value === \"object\" && value !== null && [" + strings.Join(quoted, ", ") + "].includes((value as {readonly _tag?:unknown})._tag as string); "
			if i > 0 {
				text += " else "
			}
			text += "if (" + predicate + "(" + main + ")) { "
		}
		if clause.name != nil {
			text += "const " + clause.name.Text() + " = " + main + "; "
		}
		text += file.Text()[clause.open+1:clause.end-1] + " }"
	}
	if !untyped {
		text += " else { throw " + main + " }"
	}
	return strings.Replace(text, "=> { ", "=> { "+predicates, 1) + " }", true
}

// hasRetiredTryClause distinguishes the retired typed/Cause catches and
// exit-aware finalizers from ordinary native statement clauses.
func hasRetiredTryClause(file *ast.SourceFile, node *ast.Node) bool {
	if !ast.IsTryStatement(node) || isHandleStatement(node) {
		return false
	}
	statement := node.AsTryStatement()
	return retiredCatchOf(file, node) != nil || statement.FinallyBlock != nil && exitBinding(statement.FinallyBlock) != nil
}

// withoutRetiredStatementTypedFixes leaves typed catch-expression fixes
// available, but prevents the older statement quick fix from consuming a
// typed clause before its preserving migration (or after its safe refusal).
func withoutRetiredStatementTypedFixes(p proposal) proposal {
	if p.file == nil {
		return p
	}
	var clauses []sourceEdit
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		if ast.IsTryStatement(n) && inEffectCode(n) && retiredCatchOf(p.file, n) != nil {
			clause := n.AsTryStatement().CatchClause
			clauses = append(clauses, sourceEdit{nodeStart(p.file, clause), clause.End(), ""})
		}
		return n.ForEachChild(visit)
	}
	p.file.AsNode().ForEachChild(visit)
	p.fixes = slices.DeleteFunc(p.fixes, func(f fileFix) bool {
		return f.code == 2112 && slices.ContainsFunc(f.edits, func(e sourceEdit) bool {
			return slices.ContainsFunc(clauses, func(clause sourceEdit) bool { return e.start == clause.start && e.end == clause.end })
		})
	})
	return p
}
