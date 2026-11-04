package vibelang

import (
	"context"
	"fmt"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/ls/change"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/printer"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

const mutableErrorRelicLabel = "mutable error compatibility classes"

// A plain error marker affects payload declaration bytes, even though Effect
// wraps that payload in Readonly. Retain the exact existing runtime TaggedError
// factory as an explicit class; Data.TaggedError alone would lose its matcher.
func mutableErrorRelicFixes(_ context.Context, _ *compiler.Program, file *ast.SourceFile, refused map[string]bool) proposal {
	result := proposal{file: file}
	if !isVibeLangFile(file) {
		return result
	}
	_, forms := parser.ParseVibeLangSyntax(file.ParseOptions(), file.Text())
	key := "mutable-error-relic:" + file.Text()
	if refused[key] {
		return result
	}
	alias := freshSchemaFlagName(file.Text(), "$MutableErrorBase")
	emit := printer.NewEmitContext()
	p := printer.NewPrinter(printer.PrinterOptions{NewLine: core.NewLineKindLF}, printer.PrintHandlers{}, emit)
	var edits []sourceEdit
	var visit func(*ast.Node) bool
	visit = func(class *ast.Node) bool {
		if !errorDeclarationBase(class) {
			return class.ForEachChild(visit)
		}
		base := ast.GetClassExtendsHeritageElement(class)
		if class.TypeParameters() != nil || !isSynthesizedName(base.Expression().Expression(), "TaggedError") {
			return false
		}
		args := base.AsExpressionWithTypeArguments().TypeArguments
		if args == nil || len(args.Nodes) != 1 || !ast.IsTypeLiteralNode(args.Nodes[0]) {
			return false
		}
		marked := false
		for _, field := range args.Nodes[0].Members() {
			for _, form := range forms {
				if form.Kind == parser.VibeSyntaxMutable && form.Word.Pos() == nodeStart(file, field) {
					marked = true
				}
			}
		}
		if !marked {
			return false
		}
		start, prefix, ok := errorDeclarationClassPrefix(file.Text(), class)
		if !ok {
			return false
		}
		call := p.Emit(base.Expression(), file)
		head := strings.Replace(call, "TaggedError(", alias+"(", 1)
		if head == call {
			return false
		}
		// The printer drops trivia around the legacy marker. Keep the original
		// payload slices instead, making only the modifiers explicit.
		var fields, detachedComments []string
		for _, field := range args.Nodes[0].Members() {
			text := file.Text()[field.Pos():field.End()]
			start := nodeStart(file, field)
			marked := false
			for _, form := range forms {
				if form.Kind == parser.VibeSyntaxMutable && form.Word.Pos() == start {
					at := start - field.Pos()
					text = text[:at] + text[at+len("mutable"):]
					marked = true
					break
				}
			}
			if !marked {
				// A property can itself be named readonly. Inspect written modifier
				// nodes, rather than confusing that name with a modifier token.
				writtenReadonly := false
				if modifiers := field.Modifiers(); modifiers != nil {
					for _, modifier := range modifiers.Nodes {
						if modifier.Kind == ast.KindReadonlyKeyword && modifier.Flags&ast.NodeFlagsReparsed == 0 {
							writtenReadonly = true
						}
					}
				}
				if !writtenReadonly {
					at := scanner.SkipTrivia(text, 0)
					text = text[:at] + "readonly " + text[at:]
				}
			}
			if marked || field.Flags&ast.NodeFlagsHasJSDoc == 0 {
				// Keep the original leading comments, but do not promote a doc
				// after mutable into a new public declaration comment.
				leadingDocs := map[string]int{}
				for comment := range scanner.GetLeadingCommentRanges(emit.Factory.AsNodeFactory(), file.Text(), field.Pos()) {
					text := file.Text()[comment.Pos():comment.End()]
					if strings.HasPrefix(text, "/**") {
						leadingDocs[text]++
					}
				}
				lex := scanner.NewScanner()
				lex.SetSkipTrivia(false)
				lex.SetText(text[:scanner.SkipTrivia(text, 0)])
				var prefix strings.Builder
				last := 0
				for token := lex.Scan(); token != ast.KindEndOfFile; token = lex.Scan() {
					if token == ast.KindMultiLineCommentTrivia && strings.HasPrefix(lex.TokenText(), "/**") {
						if leadingDocs[lex.TokenText()] != 0 {
							leadingDocs[lex.TokenText()]--
							continue
						}
						prefix.WriteString(text[last:lex.TokenStart()])
						detachedComments = append(detachedComments, lex.TokenText())
						last = lex.TokenEnd()
					}
				}
				if last != 0 {
					text = prefix.String() + text[last:]
				}
			}
			text = strings.TrimRight(text, " \t\r\n")
			if !strings.HasSuffix(text, ";") && !strings.HasSuffix(text, ",") {
				text += ";"
			}
			fields = append(fields, text)
		}
		head += "<{\n" + strings.Join(fields, "\n") + "\n}>"
		if clauses := class.ClassLikeData().HeritageClauses; clauses != nil {
			for _, clause := range clauses.Nodes {
				if clause.AsHeritageClause().Token == ast.KindImplementsKeyword {
					head += " " + p.Emit(clause, file)
				}
			}
		}
		var members []string
		for _, member := range class.Members() {
			if member.Flags&ast.NodeFlagsReparsed == 0 {
				members = append(members, file.Text()[member.Pos():member.End()])
			}
		}
		last := args.Nodes[0].End()
		for _, member := range class.Members() {
			if member.Flags&ast.NodeFlagsReparsed == 0 && member.End() > last {
				last = member.End()
			}
		}
		tail := ""
		for _, form := range forms {
			if form.Kind == parser.VibeSyntaxDeclaration && form.Close.End() == class.End() && form.Close.Pos() >= last {
				tail = file.Text()[last:form.Close.Pos()]
				break
			}
		}
		replacement := prefix + class.Name().Text() + " extends " + head + " {" + strings.Join(members, "\n") + tail + "\n" + strings.Join(detachedComments, "\n") + "\n}"
		edits = append(edits, sourceEdit{start, class.End(), replacement})
		return false
	}
	file.AsNode().ForEachChild(visit)
	if len(edits) == 0 {
		return result
	}
	at := change.GetInsertionPositionAtSourceFileTop(file)
	if at == 0 && strings.HasPrefix(file.Text(), "\ufeff") {
		at = len("\ufeff")
	}
	added := fmt.Sprintf("import { TaggedError as %s } from \"vibelang-runtime\";\n", alias)
	if at > 0 {
		added = "\n" + added
	}
	// An insertion at the first declaration's replacement boundary is folded
	// into that replacement so the gate never sees overlapping edits.
	merged := false
	for i := range edits {
		if edits[i].start == at {
			edits[i].text = added + edits[i].text
			merged = true
			break
		}
	}
	if !merged {
		edits = append(edits, sourceEdit{at, at, added})
	}
	result.fixes = append(result.fixes, fileFix{label: mutableErrorRelicLabel, key: key, edits: edits})
	return result
}
