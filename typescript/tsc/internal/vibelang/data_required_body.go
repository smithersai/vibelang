package vibelang

import (
	"context"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

// VIP-16 and Appendix A recognize data [no LineTerminator here] BindingIdentifier.
var EK1604 = message(parser.VibeLangDataMissingBodyCode, errorCategory, parser.VibeLangDataMissingBodyMessage)

const dataExpressionFixTitle = "Preserve the data expression with parentheses"

func init() {
	registry[EK1604.Code] = EK1604
	tsFormFixCodes = append(tsFormFixCodes, EK1604.Code)
	vipMigrationFixCodes = append(vipMigrationFixCodes, EK1604.Code)
	ls.RegisterCodeFixProvider(&ls.CodeFixProvider{
		Source:     diagnosticSource,
		ErrorCodes: []int32{EK1604.Code},
		GetCodeActions: func(_ context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
			edits := dataHeaderExpressionEdits(fix.SourceFile, &fix.Span)
			if len(edits) == 0 {
				return nil, nil
			}
			var changes []*lsproto.TextEdit
			for _, e := range edits {
				changes = append(changes, replaceRange(fix, e.start, e.end, e.text)...)
			}
			return []*ls.CodeAction{{Description: dataExpressionFixTitle, Changes: changes}}, nil
		},
	})
}

// Recover the complete expression by parsing it after return in the same source
// context. This avoids declaration precedence and retains VibeLang is-patterns
// as well as TypeScript assertions, comments and continuations. The return is
// used only to discover bounds; the actual edit inserts two parentheses.
func dataHeaderExpressionEdits(file *ast.SourceFile, at *core.TextRange) []sourceEdit {
	if file == nil || !isVibeLangFile(file) {
		return nil
	}
	var selected []*ast.Diagnostic
	for _, d := range file.Diagnostics() {
		if d.Source() == diagnosticSource && d.Code() == EK1604.Code && (at == nil || d.Loc() == *at) {
			selected = append(selected, d)
		}
	}
	if len(selected) == 0 {
		return nil
	}
	text := file.Text()
	var edits []sourceEdit
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		if parser.IsDataDeclaration(n) {
			name := n.Name()
			if name.Text() != "as" && name.Text() != "satisfies" && name.Text() != "is" {
				return false
			}
			selectedHere := false
			for _, d := range selected {
				selectedHere = selectedHere || d.Pos() == name.End()
			}
			if !selectedHere {
				return false
			}
			start := nodeStart(file, n)
			const prefix = "return "
			opts := ast.SourceFileParseOptions{FileName: "/data-repair.vibe", PathKey: "/data-repair.vibe"}
			kind := core.ScriptKindTS
			if strings.HasSuffix(file.FileName().AsString(), ".vibex") {
				opts = ast.SourceFileParseOptions{FileName: "/data-repair.vibex", PathKey: "/data-repair.vibex"}
				kind = core.ScriptKindTSX
			}
			forced := parser.ParseSourceFile(opts, text[:start]+prefix+text[start:], kind)
			var expression *ast.Node
			var find func(*ast.Node) bool
			find = func(node *ast.Node) bool {
				if node.Kind == ast.KindReturnStatement && nodeStart(forced, node) == start {
					expression = node.Expression()
					return true
				}
				return node.ForEachChild(find)
			}
			forced.AsNode().ForEachChild(find)
			if expression == nil || nodeStart(forced, expression) != start+len(prefix) {
				return false
			}
			end := expression.End() - len(prefix)
			if end <= name.End() || end > len(text) {
				return false
			}
			for _, d := range forced.Diagnostics() {
				if d.Pos() >= start && d.Pos() <= expression.End() {
					return false
				}
			}
			edits = []sourceEdit{{start, start, "("}, {end, end, ")"}}
			return true
		}
		return n.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
	return edits
}
