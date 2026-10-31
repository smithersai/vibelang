package vibelang

import (
	"context"
	"slices"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// fixSpans returns, for each fix of p, the ranges of p.text() its edits
// wrote, or none for a fix whose text the unused-import cleanup changed.
func (p proposal) fixSpans() [][]core.TextRange {
	type placed struct {
		edit sourceEdit
		fix  int
	}
	var edits []placed
	var all []sourceEdit
	for i, f := range p.fixes {
		for _, e := range f.edits {
			edits = append(edits, placed{e, i})
			all = append(all, e)
		}
	}
	slices.SortStableFunc(edits, func(a, b placed) int { return a.edit.start - b.edit.start })
	spans := make([][]core.TextRange, len(p.fixes))
	delta := 0
	for _, e := range edits {
		start := e.edit.start + delta
		spans[e.fix] = append(spans[e.fix], core.NewTextRange(start, start+len(e.edit.text)))
		delta += len(e.edit.text) - (e.edit.end - e.edit.start)
	}
	applied := applyEdits(p.file.Text(), all)
	final := p.text()
	if final == applied {
		return spans
	}
	// The cleanup removed imports: the text before its first change and
	// after its last stays, shifted by the length it removed.
	prefix := 0
	for prefix < len(applied) && prefix < len(final) && applied[prefix] == final[prefix] {
		prefix++
	}
	suffix := 0
	for suffix < len(applied)-prefix && suffix < len(final)-prefix && applied[len(applied)-1-suffix] == final[len(final)-1-suffix] {
		suffix++
	}
	shift := len(final) - len(applied)
	for i, ranges := range spans {
		moved := make([]core.TextRange, 0, len(ranges))
		for _, r := range ranges {
			switch {
			case r.End() <= prefix:
				moved = append(moved, r)
			case r.Pos() >= len(applied)-suffix:
				moved = append(moved, core.NewTextRange(r.Pos()+shift, r.End()+shift))
			default:
				moved = nil
			}
			if moved == nil {
				break
			}
		}
		spans[i] = moved
	}
	return spans
}

// programErrors returns the errors program reports, of every kind. It
// collects each kind whatever the others hold, as the language server
// does: GetDiagnosticsOfAnyProgram stops at syntax errors, so a syntax
// error anywhere would hide every type error a fix adds.
func programErrors(ctx context.Context, program *compiler.Program) []*ast.Diagnostic {
	var errors []*ast.Diagnostic
	for _, d := range slices.Concat(
		program.GetConfigFileParsingDiagnostics(),
		program.GetSyntacticDiagnostics(ctx, nil),
		program.GetProgramDiagnostics(),
		program.GetGlobalDiagnostics(ctx),
		program.GetBindDiagnostics(ctx, nil),
		program.GetSemanticDiagnostics(ctx, nil),
	) {
		if d.Category() == diagnostics.CategoryError {
			errors = append(errors, d)
		}
	}
	return errors
}

// blameReads returns the fixes whose text, in spans, holds a declaration
// that an error of errors whose key is in keys reads: a name in the
// statement of the error resolves to it, or to a declaration of the project
// that reads it, and so on. The fixes come in the order it reaches them, nearest first.
func blameReads(ctx context.Context, program *compiler.Program, errors []*ast.Diagnostic, keys map[string]int, spans fixSpanSet) [][2]int {
	var reached [][2]int
	c, done := program.GetTypeChecker(ctx)
	defer done()
	own := func(file *ast.SourceFile) bool {
		return file != nil && !file.IsDeclarationFile && !strings.Contains(file.FileName().AsString(), "/node_modules/") && !program.IsSourceFileFromExternalLibrary(file)
	}
	const errorLimit, nameLimit = 64, 20000
	walked := 0
	names := 0
	seen := map[*ast.Node]bool{}
	for _, d := range errors {
		if walked == errorLimit || names >= nameLimit {
			break
		}
		if d.File() == nil || keys[errorKey(d)] == 0 {
			continue
		}
		walked++
		// The statement that holds the error names what it reads, where
		// the node of the error may be a literal that names nothing.
		node := nodeCovering(d.File().AsNode(), d.Pos(), d.End())
		for node.Parent != nil && !ast.IsStatement(node) {
			node = node.Parent
		}
		level := []*ast.Node{node}
		for len(level) > 0 && names < nameLimit {
			var next []*ast.Node
			var visit func(*ast.Node) bool
			visit = func(n *ast.Node) bool {
				if names >= nameLimit {
					return true
				}
				if !ast.IsIdentifier(n) {
					return n.ForEachChild(visit)
				}
				names++
				symbol := c.GetSymbolAtLocation(n)
				if symbol != nil && symbol.Flags()&ast.SymbolFlagsAlias != 0 {
					symbol = c.GetAliasedSymbol(symbol)
				}
				if symbol == nil {
					return false
				}
				for _, decl := range symbol.Declarations() {
					if seen[decl] {
						continue
					}
					seen[decl] = true
					file := ast.GetSourceFileOfNode(decl)
					if !own(file) {
						continue
					}
					for _, h := range spans.holding(file.FileName(), decl.Pos(), decl.End()) {
						if !slices.Contains(reached, h) {
							reached = append(reached, h)
						}
					}
					next = append(next, decl)
				}
				return false
			}
			for _, n := range level {
				visit(n)
			}
			level = next
		}
	}
	return reached
}

// nodeCovering returns the deepest node under root whose range holds pos to
// end, or root.
func nodeCovering(root *ast.Node, pos, end int) *ast.Node {
	node := root
	for {
		var child *ast.Node
		node.ForEachChild(func(n *ast.Node) bool {
			if n.Pos() <= pos && end <= n.End() {
				child = n
				return true
			}
			return false
		})
		if child == nil {
			return node
		}
		node = child
	}
}
