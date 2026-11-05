package vibelang

import (
	"context"
	_ "embed"
	"regexp"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

//go:embed join_legacy_module.ts
var legacyJoinModule string

func init() {
	tsFormFixCodes = append(tsFormFixCodes, EK1704.Code)
	vipMigrationFixCodes = append(vipMigrationFixCodes, EK1704.Code)
	ls.RegisterCodeFixProvider(legacyCollectionJoinFix)
}

// legacyJoinCollection recognizes the old shallow collection domain. Its
// values must be Fibers; arbitrary objects, callables and unknown values do
// not establish an intention to use the retired collection operation.
func legacyJoinCollection(c *checker.Checker, t *checker.Type, _ int) bool {
	return t != nil && !isJoinable(c, t, 1) && isJoinable(c, t, 0)
}

var legacyJoinHeader = regexp.MustCompile("(?m)^module ([A-Za-z_$][A-Za-z0-9_$]*) \\{\\n" + regexp.QuoteMeta(strings.TrimSpace(legacyJoinModule)) + "\\n\\}\\nimport \\{ \\$join as ([A-Za-z_$][A-Za-z0-9_$]*) \\} from ([A-Za-z_$][A-Za-z0-9_$]*)\\n")

func existingLegacyJoin(c *checker.Checker, file *ast.SourceFile, at *ast.Node) string {
	text := file.Text()
	for _, match := range legacyJoinHeader.FindAllStringSubmatchIndex(text, -1) {
		name, alias, source := text[match[2]:match[3]], text[match[4]:match[5]], text[match[6]:match[7]]
		if name != source {
			continue
		}
		symbol := c.ResolveName(alias, at, ast.SymbolFlagsValue|ast.SymbolFlagsAlias, false)
		if symbol == nil || symbol.Flags()&ast.SymbolFlagsAlias == 0 {
			continue
		}
		for _, declaration := range symbol.Declarations() {
			if ast.IsImportSpecifier(declaration) && ast.GetSourceFileOfNode(declaration) == file && declaration.Pos() >= match[0] && declaration.End() <= match[1] {
				return alias
			}
		}
	}
	return ""
}

func legacyJoinCollectionRewrite(c *checker.Checker, file *ast.SourceFile, call *ast.Node) *formRewrite {
	if !ast.IsCallExpression(call) || len(call.Arguments()) != 1 || !inEffectCode(call) {
		return &formRewrite{}
	}
	if fiberHelper(call) != "$join" && !isPreludeJoin(c, call) {
		return &formRewrite{}
	}
	return legacyCollectionRewrite(c, file, call, call.Arguments()[0])
}

func legacyCollectionRewrite(c *checker.Checker, file *ast.SourceFile, call, operand *ast.Node) *formRewrite {
	if !inEffectCode(call) || !legacyJoinCollection(c, c.GetTypeAtLocation(operand), 0) {
		return &formRewrite{}
	}
	alias := existingLegacyJoin(c, file, call)
	var edits []sourceEdit
	if alias == "" {
		names := &freshNames{file: file}
		module := names.freshName("$LegacyJoin")
		alias = names.freshName("$joinCollection")
		header := "\nmodule " + module + " {\n" + strings.TrimSpace(legacyJoinModule) + "\n}\nimport { $join as " + alias + " } from " + module + "\n"
		pos := retiredAwaitImportPosition(file)
		edits = append(edits, sourceEdit{pos, pos, header})
	}
	text := "try " + alias + "(" + nodeText(file, operand) + ")"
	if tryNeedsParentheses(call) {
		text = "(" + text + ")"
	}
	edits = append(edits, sourceEdit{nodeStart(file, call), call.End(), text})
	return &formRewrite{edits: edits, description: "a preserving legacy collection join"}
}

var legacyCollectionJoinFix = &ls.CodeFixProvider{
	Source:     diagnosticSource,
	ErrorCodes: []int32{EK1704.Code},
	GetCodeActions: func(ctx context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
		c, done := fix.Program.GetTypeCheckerForFile(ctx, fix.SourceFile)
		defer done()
		var rewrite *formRewrite
		var visit func(*ast.Node) bool
		visit = func(node *ast.Node) bool {
			if ast.IsCallExpression(node) && scanner.GetRangeOfTokenAtPosition(fix.SourceFile, node.Pos()).Pos() == fix.Span.Pos() {
				if r := legacyJoinCollectionRewrite(c, fix.SourceFile, node); r.fixable() {
					rewrite = r
					return true
				}
			}
			return node.ForEachChild(visit)
		}
		fix.SourceFile.AsNode().ForEachChild(visit)
		if rewrite == nil {
			return nil, nil
		}
		var changes []*lsproto.TextEdit
		for _, edit := range rewrite.edits {
			changes = append(changes, replaceRange(fix, edit.start, edit.end, edit.text)...)
		}
		return []*ls.CodeAction{{Description: "Preserve the legacy collection join", Changes: changes}}, nil
	},
}
