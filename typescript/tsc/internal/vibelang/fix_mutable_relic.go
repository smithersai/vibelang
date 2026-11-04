package vibelang

import (
	"fmt"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

const mutableRelicLabel = "redundant mutable markers"

// VIPs never adopted D134 for TypeScript members. The parser records the
// contextual token separately from identifiers named mutable. Do not strip
// custom bodies: their payload declarations or codec mutability can differ.
func mutableRelicFixes(file *ast.SourceFile, refused map[string]bool) proposal {
	result := proposal{file: file}
	if !isVibeLangFile(file) {
		return result
	}
	raw, forms := parser.ParseVibeLangSyntax(file.ParseOptions(), file.Text())
	members := map[int]bool{}
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if ast.IsPropertySignatureDeclaration(node) || ast.IsIndexSignatureDeclaration(node) {
			members[nodeStart(raw, node)] = true
		}
		return node.ForEachChild(visit)
	}
	raw.AsNode().ForEachChild(visit)
	for _, form := range forms {
		if form.Kind != parser.VibeSyntaxMutable || !members[form.Word.Pos()] {
			continue
		}
		custom := false
		for _, holder := range forms {
			if holder.Kind == parser.VibeSyntaxDeclaration && holder.Range.Pos() <= form.Word.Pos() && form.Word.End() <= holder.Range.End() {
				custom = true
				break
			}
		}
		if custom {
			continue
		}
		start, end := form.Word.Pos(), form.Word.End()
		// Consume one separating space/tab; preserve every comment and newline.
		if end < len(file.Text()) && (file.Text()[end] == ' ' || file.Text()[end] == '\t') {
			end++
		}
		key := fmt.Sprintf("mutable-relic:%d", start)
		if !refused[key] {
			edits := []sourceEdit{{start, end, ""}}
			// A JSDoc comment after the consumed marker was not a leading
			// member comment. Keep it on an empty statement so removing the marker
			// does not add a public declaration comment.
			lex := scanner.NewScanner()
			lex.SetSkipTrivia(false)
			lex.SetText(file.Text()[form.Word.End():scanner.SkipTrivia(file.Text(), form.Word.End())])
			var docs []string
			for token := lex.Scan(); token != ast.KindEndOfFile; token = lex.Scan() {
				if token == ast.KindMultiLineCommentTrivia && strings.HasPrefix(lex.TokenText(), "/**") {
					docs = append(docs, lex.TokenText())
					edits = append(edits, sourceEdit{form.Word.End() + lex.TokenStart(), form.Word.End() + lex.TokenEnd(), ""})
				}
			}
			if len(docs) != 0 {
				at := len(file.Text())
				edits = append(edits, sourceEdit{at, at, "\n;\n" + strings.Join(docs, "\n") + ";\n"})
			}
			result.fixes = append(result.fixes, fileFix{label: mutableRelicLabel, key: key, edits: edits})
		}
	}
	return result
}
