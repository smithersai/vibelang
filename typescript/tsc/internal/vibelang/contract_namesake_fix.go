package vibelang

import (
	"context"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

// A contract that names an ambient type where its body needs Effect's.
//
// VIP-14 resolves a bare name per meaning: in a type position an ambient
// type keeps its name, so with the DOM lib loaded the FileSystem of
//
//	export effect function read(): Effect<string, never, FileSystem> {
//	  const fs = try FileSystem()
//	  …
//	}
//
// is the DOM's FileSystem interface, while FileSystem() reads Effect's
// FileSystem service. Before VIP-14 the bare type meant Effect's, so such a
// contract compiled; now the body's requirement escapes it (EK9202). The fix
// writes the contract's type through its module, FileSystem.FileSystem, the
// meaning the contract had, so --fix and --fix-vip-only migrate it. It is
// offered only where the contract's member and the body's requirement share
// the bare name and the module of that name exports the requirement's type
// (ambientNamesake); an EK9201 failure type gets the same fix.

func init() {
	tsFormFixCodes = append(tsFormFixCodes, EK9201.Code, EK9202.Code)
	vipMigrationFixCodes = append(vipMigrationFixCodes, EK9201.Code, EK9202.Code)
	ls.RegisterCodeFixProvider(contractNamesakeFix)
}

var contractNamesakeFix = &ls.CodeFixProvider{
	Source:     diagnosticSource,
	ErrorCodes: []int32{EK9201.Code, EK9202.Code},
	GetCodeActions: func(ctx context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
		c, done := fix.Program.GetTypeCheckerForFile(ctx, fix.SourceFile)
		defer done()
		edits := contractNamesakeEdits(c, fix.SourceFile, fix.Span.Pos(), fix.Span.End())
		if len(edits) == 0 {
			return nil, nil
		}
		var changes []*lsproto.TextEdit
		description := ""
		for _, edit := range edits {
			changes = append(changes, replaceRange(fix, edit.start, edit.end, edit.text)...)
			description = "Write " + edit.text + ", Effect's type, in the contract"
		}
		return []*ls.CodeAction{{Description: description, Changes: changes}}, nil
	},
}

// contractNamesakeEdits returns the edits that write, through its module,
// each ambient type the contract of the function around [pos, end) names
// where an escape reported there needs Effect's type of the same name.
func contractNamesakeEdits(c *checker.Checker, file *ast.SourceFile, pos, end int) []sourceEdit {
	a := analyzerFor(c)
	var fn *ast.Node
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if node.Pos() > pos || node.End() < end {
			return false
		}
		if isLowerable(node) && node.Type() != nil {
			fn = node // the innermost function around the span
		}
		node.ForEachChild(visit)
		return false
	}
	file.AsNode().ForEachChild(visit)
	if fn == nil || a.contractOf(fn) == nil || a.isFactory(fn) {
		return nil
	}
	info := a.effectOf(fn)
	if info == nil {
		return nil
	}
	contractType := c.GetReturnTypeOfSignature(c.GetSignatureFromDeclaration(fn))
	ambient := map[*ast.Symbol]string{}
	for _, channel := range []struct {
		name    string
		types   []*checker.Type
		sources []*ast.Node
	}{{"_E", info.errors, info.errorSources}, {"_R", info.requirements, info.requirementSources}} {
		declared := channelType(c, contractType, channel.name)
		for _, escape := range escapes(c, channel.types, channel.sources, declared) {
			if nodeStart(file, escape.source) > pos || escape.source.End() < end {
				continue
			}
			if namesake := ambientNamesake(c, declared, escape.t, escape.source); namesake != nil {
				ambient[namesake.Symbol()] = namesake.Symbol().Name()
			}
		}
	}
	if len(ambient) == 0 {
		return nil
	}
	var edits []sourceEdit
	var walk func(*ast.Node) bool
	walk = func(node *ast.Node) bool {
		if ast.IsTypeReferenceNode(node) {
			if name := node.AsTypeReferenceNode().TypeName; ast.IsIdentifier(name) {
				symbol := c.GetSymbolAtLocation(name)
				if text, ok := ambient[symbol]; ok && name.Text() == text {
					edits = append(edits, sourceEdit{nodeStart(file, name), name.End(), text + "." + text})
				}
			}
		}
		return node.ForEachChild(walk)
	}
	walk(fn.Type())
	return edits
}
