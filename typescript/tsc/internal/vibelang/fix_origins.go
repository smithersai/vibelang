package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"strings"
)

// errorSources only orders the search: every candidate still needs the same
// complete comparison against baseline. Missing or broad origins use bisection.
func (g *fixGate) errorSources(ps []proposal) map[tspath.RootedFilePath]bool {
	program := g.lastFailed
	if program == nil {
		return nil
	}
	proposed := map[tspath.RootedFilePath]bool{}
	originals := map[tspath.RootedFilePath]*ast.SourceFile{}
	for _, p := range ps {
		proposed[p.file.FileName()] = true
		originals[p.file.FileName()] = p.file
	}
	// Only imports that can reach an edited source can lead to a culprit.
	reaches := map[tspath.RootedFilePath]bool{}
	reverse := map[tspath.RootedFilePath][]tspath.RootedFilePath{}
	for _, f := range program.SourceFiles() {
		for _, r := range program.GetResolvedModules()[f.PathKey()] {
			if r == nil || !r.IsResolved() {
				continue
			}
			if target := program.GetSourceFileForResolvedModule(r); target != nil {
				reverse[target.FileName()] = append(reverse[target.FileName()], f.FileName())
			}
		}
	}
	var pending []tspath.RootedFilePath
	for name := range proposed {
		reaches[name] = true
		pending = append(pending, name)
	}
	for i := 0; i < len(pending); i++ {
		for _, name := range reverse[pending[i]] {
			if !reaches[name] {
				reaches[name] = true
				pending = append(pending, name)
			}
		}
	}
	scores := map[tspath.RootedFilePath]int{}
	editedScores := map[tspath.RootedFilePath]int{}
	direct := map[tspath.RootedFilePath]bool{}
	budget := 2048
	spanKey := g.baseline.spanKeys()
	for _, d := range compiler.GetDiagnosticsOfAnyProgram(g.ctx, program, nil, false, program.GetBindDiagnostics, program.GetSemanticDiagnostics) {
		if d.Category() != diagnostics.CategoryError || d.File() == nil || (d.Code() != 2322 && d.Code() != 2345) || g.baseline.messages[errorKey(d)] > 0 || g.baseline.spans[spanKey(d)] > 0 {
			continue
		}
		file := d.File()
		if proposed[file.FileName()] {
			direct[file.FileName()] = true
		}
		sources := map[tspath.RootedFilePath]bool{}
		visited := map[*ast.Node]bool{}
		localBudget := 256
		root := ast.GetNodeAtPosition(file, d.Pos(), false)
		for root.Parent != nil && !originExpression(root) {
			if ast.IsStatement(root) {
				break
			}
			root = root.Parent
		}
		c, done := program.GetTypeCheckerForFile(g.ctx, file)

		queue := []*ast.Node{root}
		for at := 0; at < len(queue) && budget > 0 && localBudget > 0; at++ {
			n := queue[at]
			if n == nil || visited[n] {
				continue
			}
			visited[n] = true
			budget--
			localBudget--
			if ast.IsIdentifier(n) || ast.IsPropertyAccessExpression(n) {
				symbol := c.GetSymbolAtLocation(n)
				if symbol != nil && symbol.Flags()&ast.SymbolFlagsAlias != 0 {
					symbol = c.GetAliasedSymbol(symbol)
				}
				if symbol != nil {
					for _, decl := range symbol.Declarations() {
						source := ast.GetSourceFileOfNode(decl)
						if source == nil || !reaches[source.FileName()] {
							continue
						}
						if proposed[source.FileName()] && source != file && originDeclarationEdited(originals[source.FileName()], source, decl) {
							sources[source.FileName()] = true
							continue
						}
						if ast.IsVariableDeclaration(decl) {
							queue = append(queue, decl.Initializer())
						}
					}
				}
			}
			n.ForEachChild(func(child *ast.Node) bool { queue = append(queue, child); return false })
		}

		done()
		if len(sources) <= 8 {
			for name := range sources {
				if proposed[file.FileName()] && !originReporterStable(originals[file.FileName()], file, root) {
					editedScores[name]++
				} else {
					scores[name]++
				}
			}
		}
		if budget <= 0 {
			break
		}
	}
	// Several importer errors often share one changed dependency, while each
	// mentions other unrelated imports. Keep that common origin instead of
	// discarding all hints when their union grows.
	if len(scores) == 0 {
		scores = editedScores
	}
	if len(scores) == 0 {
		if len(direct) > 8 {
			return nil
		}
		return direct
	}
	maximum := 0
	for _, score := range scores {
		maximum = max(maximum, score)
	}
	sources := map[tspath.RootedFilePath]bool{}
	for name, score := range scores {
		if score == maximum {
			sources[name] = true
		}
	}
	if len(sources) > 8 {
		return nil
	}
	return sources
}

func originExpression(n *ast.Node) bool {
	switch n.Kind {
	case ast.KindArrayLiteralExpression, ast.KindObjectLiteralExpression,
		ast.KindPropertyAssignment, ast.KindCallExpression, ast.KindVariableDeclaration,
		ast.KindReturnStatement, ast.KindBinaryExpression:
		return true
	}
	return false
}

// This is a search hint, never an acceptance proof. A declaration with one
// byte-identical occurrence in the proposed file's original source is not the
// edit to blame; follow its dependencies instead. Ambiguity keeps the old
// conservative file-level candidate.
func originDeclarationEdited(original, changed *ast.SourceFile, decl *ast.Node) bool {
	owner := decl
	for owner.Parent != nil {
		if ast.IsVariableDeclaration(owner) || ast.IsFunctionDeclaration(owner) || ast.IsClassDeclaration(owner) || ast.IsTypeAliasDeclaration(owner) || ast.IsInterfaceDeclaration(owner) {
			break
		}
		owner = owner.Parent
	}
	if ast.IsSourceFile(owner) {
		return true
	}
	text := nodeText(changed, owner)
	return len(text) == 0 || strings.Count(original.Text(), text) != 1
}

// An unrelated alias edit does not turn a stable provider into an edited error
// context. Prefer those importers over errors inside a rewritten function.
func originReporterStable(original, changed *ast.SourceFile, node *ast.Node) bool {
	if original == nil {
		return true
	}
	for n := node; n != nil && !ast.IsSourceFile(n); n = n.Parent {
		if ast.IsVariableDeclaration(n) || ast.IsFunctionDeclaration(n) || ast.IsClassDeclaration(n) || ast.IsTypeAliasDeclaration(n) || ast.IsInterfaceDeclaration(n) {
			if originDeclarationEdited(original, changed, n) {
				return false
			}
		}
	}
	return true
}
