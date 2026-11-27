package vibelangestree

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

func (c *converter) convertStatementNode(n *ast.Node, parent *ast.Node) (*obj, bool) {
	if result, ok := c.convertBlockOrModuleStatement(n, parent); ok {
		return result, true
	}
	if result, ok := c.convertControlFlowStatement(n, parent); ok {
		return result, true
	}
	if result, ok := c.convertTryAndLoopStatement(n, parent); ok {
		return result, true
	}
	return c.convertVariableNode(n, parent)
}

func (c *converter) convertBlockOrModuleStatement(n *ast.Node, parent *ast.Node) (*obj, bool) {
	switch n.Kind {
	case ast.KindSourceFile:
		file := n.AsSourceFile()
		sourceType := "script"
		if file.ExternalModuleIndicator != nil {
			sourceType = "module"
		}
		return c.nodeAt(span{scanner.SkipTrivia(c.text, 0), file.EndOfFileToken.End()}, "Program").
			set("body", c.convertBodyExpressions(listNodes(file.Statements), n, nil)).
			set("sourceType", sourceType), true
	case ast.KindBlock:
		body := c.convertBodyExpressions(n.Statements(), n, parent)
		block := c.node(n, "BlockStatement").set("body", body)
		if c.vibe {
			for _, item := range body {
				if stmt, ok := item.(*obj); ok && !stmt.isSynthesized() {
					fixParentLocation(block, stmt.rng())
				}
			}
		}
		return block, true
	case ast.KindModuleBlock:
		return c.node(n, "TSModuleBlock").set("body", c.convertBodyExpressions(n.Statements(), n, parent)), true
	case ast.KindWithStatement:
		with := n.AsWithStatement()
		return c.node(n, "WithStatement").set("body", c.convertChild(with.Statement, n)).set("object", c.convertChild(with.Expression, n)), true
	case ast.KindEmptyStatement:
		return c.node(n, "EmptyStatement"), true
	case ast.KindDebuggerStatement:
		return c.node(n, "DebuggerStatement"), true
	case ast.KindExpressionStatement:
		expr := c.convertChild(n.Expression(), n)
		stmt := c.node(n, "ExpressionStatement").set("expression", expr)
		if c.vibe && expr != nil {
			fixParentLocation(stmt, expr.rng())
		}
		return stmt, true
	}
	return nil, false
}

func (c *converter) convertControlFlowStatement(n *ast.Node, parent *ast.Node) (*obj, bool) {
	switch n.Kind {
	case ast.KindReturnStatement:
		return c.node(n, "ReturnStatement").set("argument", c.convertChild(n.Expression(), n)), true
	case ast.KindLabeledStatement:
		labeled := n.AsLabeledStatement()
		return c.node(n, "LabeledStatement").set("body", c.convertChild(labeled.Statement, n)).set("label", c.convertChild(labeled.Label, n)), true
	case ast.KindContinueStatement:
		return c.node(n, "ContinueStatement").set("label", c.convertChild(n.AsContinueStatement().Label, n)), true
	case ast.KindBreakStatement:
		return c.node(n, "BreakStatement").set("label", c.convertChild(n.AsBreakStatement().Label, n)), true
	case ast.KindIfStatement:
		ifStatement := n.AsIfStatement()
		return c.node(n, "IfStatement").
			set("alternate", c.convertChild(ifStatement.ElseStatement, n)).
			set("consequent", c.convertChild(ifStatement.ThenStatement, n)).
			set("test", c.convertChild(ifStatement.Expression, n)), true
	case ast.KindSwitchStatement:
		switchStatement := n.AsSwitchStatement()
		caseBlock := switchStatement.CaseBlock
		return c.node(n, "SwitchStatement").
			set("cases", c.convertChildren(listNodes(caseBlock.AsCaseBlock().Clauses), caseBlock)).
			set("discriminant", c.convertChild(switchStatement.Expression, n)), true
	case ast.KindCaseClause, ast.KindDefaultClause:
		clause := n.AsCaseOrDefaultClause()
		result := c.node(n, "SwitchCase").set("consequent", c.convertChildren(listNodes(clause.Statements), n))
		if n.Kind == ast.KindCaseClause {
			result.set("test", c.convertChild(clause.Expression, n))
		} else {
			result.set("test", nil)
		}
		return result, true
	case ast.KindThrowStatement:
		return c.node(n, "ThrowStatement").set("argument", c.convertChild(n.Expression(), n)), true
	}
	return nil, false
}

func (c *converter) convertTryAndLoopStatement(n *ast.Node, parent *ast.Node) (*obj, bool) {
	switch n.Kind {
	case ast.KindTryStatement:
		try := n.AsTryStatement()
		return c.node(n, "TryStatement").
			set("block", c.convertChild(try.TryBlock, n)).
			set("finalizer", c.convertChild(try.FinallyBlock, n)).
			set("handler", c.convertChild(try.CatchClause, n)), true
	case ast.KindCatchClause:
		clause := n.AsCatchClause()
		result := c.node(n, "CatchClause").set("body", c.convertChild(clause.Block, n))
		if declaration := clause.VariableDeclaration; declaration != nil && !c.synthesized(declaration.Name()) {
			result.set("param", c.convertBindingNameWithTypeAnnotation(declaration.Name(), declaration.Type(), declaration))
		} else {
			result.set("param", nil)
		}
		return result, true
	case ast.KindWhileStatement:
		while := n.AsWhileStatement()
		return c.node(n, "WhileStatement").set("body", c.convertChild(while.Statement, n)).set("test", c.convertChild(while.Expression, n)), true
	case ast.KindDoStatement:
		do := n.AsDoStatement()
		return c.node(n, "DoWhileStatement").set("body", c.convertChild(do.Statement, n)).set("test", c.convertChild(do.Expression, n)), true
	case ast.KindForStatement:
		forStatement := n.AsForStatement()
		return c.node(n, "ForStatement").
			set("body", c.convertChild(forStatement.Statement, n)).
			set("init", c.convertChild(forStatement.Initializer, n)).
			set("test", c.convertChild(forStatement.Condition, n)).
			set("update", c.convertChild(forStatement.Incrementor, n)), true
	case ast.KindForInStatement:
		forIn := n.AsForInOrOfStatement()
		return c.node(n, "ForInStatement").
			set("body", c.convertChild(forIn.Statement, n)).
			set("left", c.convertPattern(forIn.Initializer, n)).
			set("right", c.convertChild(forIn.Expression, n)), true
	case ast.KindForOfStatement:
		forOf := n.AsForInOrOfStatement()
		return c.node(n, "ForOfStatement").
			set("await", forOf.AwaitModifier != nil && forOf.AwaitModifier.Kind == ast.KindAwaitKeyword).
			set("body", c.convertChild(forOf.Statement, n)).
			set("left", c.convertPattern(forOf.Initializer, n)).
			set("right", c.convertChild(forOf.Expression, n)), true
	}
	return nil, false
}

func (c *converter) convertVariableNode(n *ast.Node, parent *ast.Node) (*obj, bool) {
	switch n.Kind {
	case ast.KindVariableDeclaration:
		declaration := n.AsVariableDeclaration()
		init := c.convertChild(declaration.Initializer, n)
		id := c.convertBindingNameWithTypeAnnotation(n.Name(), declaration.Type, n)
		declarator := c.node(n, "VariableDeclarator").
			set("definite", declaration.ExclamationToken != nil).
			set("id", id).
			set("init", init)
		if init != nil {
			fixParentLocation(declarator, init.rng())
		}
		return declarator, true
	case ast.KindVariableStatement:
		list := n.AsVariableStatement().DeclarationList
		decls := listNodes(list.AsVariableDeclarationList().Declarations)
		convertedDecls := c.convertChildren(decls, list)
		result := c.node(n, "VariableDeclaration").
			set("declarations", convertedDecls).
			set("declare", hasModifier(ast.KindDeclareKeyword, n)).
			set("kind", c.variableKind(n, list))
		for _, d := range convertedDecls {
			if o, ok := d.(*obj); ok {
				fixParentLocation(result, o.rng())
			}
		}
		allSynth := c.vibe && len(decls) > 0
		for _, d := range decls {
			name := d.Name()
			if name == nil || (!synthesized(name) && name.Flags&ast.NodeFlagsVibeLangTemporary == 0) {
				allSynth = false
				break
			}
		}
		if c.synthesized(n) || allSynth {
			result.set("synthesized", true)
		}
		return c.fixExports(n, result), true
	case ast.KindVariableDeclarationList:
		return c.node(n, "VariableDeclaration").
			set("declarations", c.convertChildren(listNodes(n.AsVariableDeclarationList().Declarations), n)).
			set("declare", false).
			set("kind", c.variableKind(n, n)), true
	}
	return nil, false
}
