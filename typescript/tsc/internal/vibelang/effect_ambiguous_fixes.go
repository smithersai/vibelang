package vibelang

import (
	"context"
	"fmt"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/astnav"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
)

func init() { ls.RegisterCodeFixProvider(ambiguousEffectImportFix) }

// An ambiguity has no preferred exporter. The editor offers each choice;
// migration alone preserves a root module that used to win the bare name.
var ambiguousEffectImportFix = &ls.CodeFixProvider{
	Source:     diagnosticSource,
	ErrorCodes: []int32{EK1401.Code},
	GetCodeActions: func(ctx context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
		name := astnav.GetTokenAtPosition(fix.SourceFile, fix.Span.Pos())
		if name == nil || !ast.IsIdentifier(name) {
			return nil, nil
		}
		var actions []*ls.CodeAction
		for _, pkg := range effectSubpathShared[name.Text()] {
			edit := ambiguousImportEdit(fix.SourceFile, name.Text(), pkg)
			actions = append(actions, &ls.CodeAction{
				Description: fmt.Sprintf("Import %s from %q", name.Text(), pkg),
				Changes:     replaceRange(fix, edit.start, edit.end, edit.text),
			})
		}
		return actions, nil
	},
}

func ambiguousImportEdit(file *ast.SourceFile, name, pkg string) sourceEdit {
	text, pos := file.Text(), 0
	if strings.HasPrefix(text, "\ufeff") {
		pos = len("\ufeff")
	}
	if strings.HasPrefix(text[pos:], "#!") {
		if end := strings.IndexByte(text[pos:], '\n'); end >= 0 {
			pos += end + 1
		} else {
			pos = len(text)
		}
	}
	prefix := ""
	if pos > 0 && text[pos-1] != '\n' && !strings.HasSuffix(text[:pos], "\ufeff") {
		prefix = "\n"
	}
	return sourceEdit{pos, pos, prefix + fmt.Sprintf("import { %s } from %q\n", name, pkg)}
}

func ambiguousRootMigrationFixes(ctx context.Context, program *compiler.Program, file *ast.SourceFile, refused map[string]bool) proposal {
	p := proposal{file: file}
	for _, d := range program.GetSemanticDiagnostics(ctx, file) {
		if d.Source() != diagnosticSource || d.Code() != EK1401.Code {
			continue
		}
		name := astnav.GetTokenAtPosition(file, d.Pos())
		if name == nil || !ast.IsIdentifier(name) {
			continue
		}
		if _, root := effectRootNames[name.Text()]; !root {
			continue
		}
		key := fixKey(file, d)
		if refused[key] {
			continue
		}
		p.fixes = append(p.fixes, fileFix{code: EK1401.Code, key: key, edits: []sourceEdit{ambiguousImportEdit(file, name.Text(), "effect")}})
		break // one insertion at a time; the next round checks the new binding
	}
	return p
}
