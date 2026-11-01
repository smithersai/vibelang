package vibelang

import (
	"slices"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// A match without a default arm ends in $noMatch(subject) (match.go). When
// D209's proof covers the match, its subject's declared type is a finite
// union and nothing of it is left after the last arm, so the lowering drops
// $noMatch. The last arm is still tested like every other arm, with its
// reads, matcher calls and comparisons (D405): a literal-typed property may
// be a getter or a proxy trap, a structural object of a class type is no
// instance, and a custom matcher may refuse an instance, so a value of the
// type can fail the test. Each test of the last arm is written as a check
// that ends the match as $noMatch does when it fails, a defect:
//
//	return match (phase) {                 { if (phase === "draft") { return "Draft" } }
//	  when "draft": "Draft";               { { runtime.$assertMatch(phase === "published", phase); return "Published" } }
//	  when "published": "Published";
//	}
//
// The check is a call, not a branch, so tests that reach every arm still
// cover every branch. The arm's declarations, its bindings and any extracted
// values, still run, so its names are bound as before. A match over any
// other type keeps $noMatch, which throws the proposal's TypeError at run
// time.

// exhaustivePlan records what the lowering changes in the matches D209
// proves exhaustive in one file.
type exhaustivePlan struct {
	unreachable map[*ast.Node]bool      // statements that call $noMatch, dropped
	checked     map[*ast.Node]*ast.Node // if statements of a last arm, emitted as a check against the subject and their blocks
	kept        bool                    // some $noMatch call stays, so the file imports $noMatch
}

func newExhaustivePlan() exhaustivePlan {
	return exhaustivePlan{unreachable: map[*ast.Node]bool{}, checked: map[*ast.Node]*ast.Node{}}
}

// planExhaustiveMatch records node, a $noMatch call, and the tests of the
// last arm before it, each checked against the subject, when D209 proves the
// match exhaustive.
func (p *exhaustivePlan) planExhaustiveMatch(c *checker.Checker, node *ast.Node) {
	if patternHelper(node) != "$noMatch" {
		return
	}
	statement := node.Parent
	for statement != nil && !ast.IsStatement(statement) {
		statement = statement.Parent
	}
	if !provenExhaustive(c, node) || statement == nil || statement.Parent == nil || statement.Parent.Kind != ast.KindBlock ||
		statement.Kind != ast.KindReturnStatement && statement.Kind != ast.KindExpressionStatement {
		p.kept = true
		return
	}
	p.unreachable[statement] = true
	// The parser writes each arm as a block whose tests are a chain of if
	// statements, each the last statement of the block before it, around
	// the arm's success statements (emitSteps, vibelang_match.go).
	statements := statement.Parent.Statements()
	i := slices.Index(statements, statement)
	if i < 1 || statements[i-1].Kind != ast.KindBlock {
		return // no arm, or only the subject's declaration
	}
	subject := node.Arguments()[0]
	for arm := statements[i-1]; arm.Kind == ast.KindBlock; {
		body := arm.Statements()
		if len(body) == 0 {
			return
		}
		test := body[len(body)-1]
		if test.Kind != ast.KindIfStatement || test.AsIfStatement().ElseStatement != nil {
			return
		}
		p.checked[test] = subject
		arm = test.AsIfStatement().ThenStatement
	}
}

// withoutUnusedNoMatch removes $noMatch from names, a file's prelude uses,
// when every $noMatch call of the file is dropped.
func (p *exhaustivePlan) withoutUnusedNoMatch(names []string) []string {
	if p.kept || len(p.unreachable) == 0 {
		return names
	}
	return slices.DeleteFunc(names, func(name string) bool { return name == "$noMatch" })
}

// visitCheckedArm emits test, an if statement of a last arm whose tests stay,
// as its block led by runtime.$assertMatch(test, subject), which ends the
// match as $noMatch does when the test fails (D405).
func (tx *lowering) visitCheckedArm(test *ast.Node, subject *ast.Node) *ast.Node {
	f := tx.Factory()
	statement := test.AsIfStatement()
	check := f.NewExpressionStatement(tx.runtimeCall("$assertMatch", tx.Visitor().VisitNode(statement.Expression), f.DeepCloneNode(tx.Visitor().VisitNode(subject))))
	tx.EmitContext().SetOriginal(check, test)
	check.Loc = statement.Expression.Loc
	statements := []*ast.Node{check}
	if then := tx.Visitor().VisitNode(statement.ThenStatement); then != nil && then.Kind == ast.KindBlock {
		statements = append(statements, then.Statements()...)
	} else if then != nil {
		statements = append(statements, then)
	}
	block := f.NewBlock(f.NewNodeList(statements), true /*multiLine*/)
	tx.EmitContext().SetOriginal(block, statement.ThenStatement)
	block.Loc = statement.ThenStatement.Loc
	return block
}
