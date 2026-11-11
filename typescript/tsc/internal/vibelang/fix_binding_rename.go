package vibelang

import (
	"slices"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/core"
)

func init() {
	checker.RegisterBindDiagnosticsFilterHook(explainBindingRename)
}

// Lexical is-pattern bindings share their enclosing home. The binder reports
// duplicate names using the same TS2451 or TS2300 diagnostic as TypeScript.
const bindingRenameNote = "Two is patterns bind {0} in one block: use distinct names or separate blocks."

// explainBindingRename adds bindingRenameNote under each TS2451 or TS2300 at
// a later is binding's name or at the declaration it repeats. The binder's
// diagnostics are shared by every checker. Copy both the diagnostic and its
// message-chain storage before appending checker-owned advice.
func explainBindingRename(c *checker.Checker, file *ast.SourceFile, ds []*ast.Diagnostic) []*ast.Diagnostic {
	if !file.IsVibeLang() {
		return ds
	}
	var out []*ast.Diagnostic
	var renames []bindingRename
	found := false
	for i, d := range ds {
		if d.Source() != "" || d.Code() != 2451 && d.Code() != 2300 || d.File() != file || hasBindingRenameNote(d) {
			continue
		}
		if !found {
			renames, found = bindingRenames(c, file), true
		}
		for _, r := range renames {
			if r.at(file, d.Loc()) {
				if out == nil {
					out = slices.Clone(ds)
				}
				explained := d.Clone().SetMessageChain(slices.Clone(d.MessageChain()))
				out[i] = note(explained, bindingRenameNote, r.name.Text())
				break
			}
		}
	}
	if out != nil {
		return out
	}
	return ds
}

func hasBindingRenameNote(d *ast.Diagnostic) bool {
	for _, chained := range d.MessageChain() {
		if chained.Source() == diagnosticSource && strings.HasPrefix(chained.MessageText(), "Two is patterns bind ") {
			return true
		}
	}
	return false
}

// A bindingRename identifies a later is binding and the declaration it repeats.
type bindingRename struct {
	name  *ast.Node // the later binding's name, where the pattern wrote it
	first *ast.Node // the declaration the name resolves to instead
}

// at reports whether span lies in the later binding's name or the first
// declaration's name: TypeScript reports the duplicate at both.
func (r bindingRename) at(file *ast.SourceFile, span core.TextRange) bool {
	in := func(node *ast.Node) bool {
		return node != nil && nodeStart(file, node) <= span.Pos() && span.End() <= node.End()
	}
	return in(r.name) || in(r.first.Name())
}

// bindingRenames returns the later is bindings whose names their lexical
// home already declares. Only binding declarations need symbol resolution;
// diagnostic advice does not compute source edits or inspect uses.
func bindingRenames(c *checker.Checker, file *ast.SourceFile) []bindingRename {
	var out []bindingRename
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		if ast.IsVariableDeclaration(node) && node.Flags&ast.NodeFlagsVibeLangIsBinding != 0 {
			name := node.Name()
			if name != nil && ast.IsIdentifier(name) {
				own := c.GetSymbolAtLocation(name)
				visible := c.ResolveName(name.Text(), node, ast.SymbolFlagsValue, true)
				if own != nil && visible != nil && visible != own {
					first := visible.ValueDeclaration()
					if first != nil && first != node && first.Name() != nil && nodeStart(file, first.Name()) < nodeStart(file, name) {
						out = append(out, bindingRename{name: name, first: first})
					}
				}
			}
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
	return out
}

// skipTriviaBackwards returns the end of the token before position end,
// skipping spaces, newlines, block comments and line comments.
func skipTriviaBackwards(text string, end int) int {
	for end > 0 {
		switch {
		case text[end-1] == ' ' || text[end-1] == '\t' || text[end-1] == '\r':
			end--
		case text[end-1] == '\n':
			end--
			line := strings.LastIndexByte(text[:end], '\n') + 1
			if comment := strings.Index(text[line:end], "//"); comment >= 0 {
				end = line + comment
			}
		case strings.HasSuffix(text[:end], "*/"):
			open := strings.LastIndex(text[:end-2], "/*")
			if open < 0 {
				return end
			}
			end = open
		default:
			return end
		}
	}
	return end
}
