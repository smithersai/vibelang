package vibelangfmt

import (
	"fmt"
	"slices"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
)

// JSX text is data, not layout (VIP-39). Leave it verbatim in the TSX
// projection, then restore its whitespace if the host reflows it. In
// particular, dprint collapses repeated spaces that JSX would render.
// Each element's non-text children delimit stable text slots.
type jsxTextSlot struct {
	span core.TextRange
	text string
}

type jsxTextLayout struct {
	kind     ast.Kind
	children []ast.Kind
	slots    []jsxTextSlot
}

func jsxTextLayouts(file *ast.SourceFile, text string) []jsxTextLayout {
	var layouts []jsxTextLayout
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		var nodes []*ast.Node
		var start, end int
		switch node.Kind {
		case ast.KindJsxElement:
			el := node.AsJsxElement()
			nodes, start, end = el.Children.Nodes, el.OpeningElement.End(), el.ClosingElement.Pos()
		case ast.KindJsxFragment:
			el := node.AsJsxFragment()
			nodes, start, end = el.Children.Nodes, el.OpeningFragment.End(), el.ClosingFragment.Pos()
		default:
			return node.ForEachChild(visit)
		}
		layout := jsxTextLayout{kind: node.Kind}
		for _, child := range nodes {
			if child.Kind == ast.KindJsxText {
				continue
			}
			layout.slots = append(layout.slots, jsxTextSlot{core.NewTextRange(start, child.Pos()), text[start:child.Pos()]})
			layout.children = append(layout.children, child.Kind)
			start = child.End()
		}
		layout.slots = append(layout.slots, jsxTextSlot{core.NewTextRange(start, end), text[start:end]})
		layouts = append(layouts, layout)
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
	return layouts
}

func (d *decoder) restoreJSXText() error {
	if d.enc.scriptKind != core.ScriptKindTSX {
		return nil
	}
	layouts := jsxTextLayouts(d.file, d.text)
	if len(layouts) != len(d.enc.jsxText) {
		return fmt.Errorf("vibelang format: the TypeScript formatter changed JSX elements")
	}
	for i, after := range layouts {
		before := d.enc.jsxText[i]
		if after.kind != before.kind || !slices.Equal(after.children, before.children) {
			return fmt.Errorf("vibelang format: the TypeScript formatter changed JSX children")
		}
		for j, slot := range after.slots {
			original := before.slots[j].text
			if slot.text == original {
				continue
			}
			if strings.Join(strings.Fields(slot.text), "") != strings.Join(strings.Fields(original), "") {
				return fmt.Errorf("vibelang format: the TypeScript formatter changed JSX text")
			}
			d.edits = append(d.edits, edit{pos: slot.span.Pos(), end: slot.span.End(), text: original, opaque: true})
		}
	}
	return nil
}

// With trailingCommas=never, the pinned dprint removes even the required
// comma in <T,> (plain, async and effect arrows). A temporary second type
// parameter keeps that comma a separator, so the formatted TSX parses.
// Decoding removes the temporary parameter and leaves the source comma.
func (e *encoder) encodeTSXArrows() {
	if e.file.ScriptKind != core.ScriptKindTSX {
		return
	}
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if node.Kind == ast.KindArrowFunction {
			params := node.TypeParameterList()
			if params != nil && len(params.Nodes) == 1 && params.HasTrailingComma() {
				pos := params.End()
				name := e.hold(placeholderGenericComma, "generic arrow comma", pos, 0)
				e.add(edit{pos: pos, end: pos, text: name})
			}
		}
		return node.ForEachChild(visit)
	}
	e.file.AsNode().ForEachChild(visit)
}
