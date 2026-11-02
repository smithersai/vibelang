package vibelang

import (
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
)

// A quick fix that takes the last use of an import out of the code removes
// the import with its other edits (withImportRemovals), as an editor action
// should. In a project that emits declarations, vibelang --fix keeps an
// import that the file's declaration file writes (D501), as its prelude
// rewrites and its final import cleanup do: EK1002's fix turns
// Effect.fn("ensure")(function* …) into an effect arrow, which no longer
// names Effect, yet the export's type is still an Effect, and the declaration
// file wrote import * as Effect from "effect/Effect". Removing the import made
// it write import { Effect } from "effect" instead, and the migrate flow's
// declaration identity gate refused the file (t3code apps/server).

// removesImport reports whether an edit of fixes removes an import binding
// of file: it covers the binding and does not write the binding's name.
func removesImport(file *ast.SourceFile, fixes []fileFix) bool {
	for _, b := range importBindingsOf(file) {
		for _, f := range fixes {
			for _, e := range f.edits {
				if removesBinding(file, e, b) {
					return true
				}
			}
		}
	}
	return false
}

func removesBinding(file *ast.SourceFile, e sourceEdit, b importBinding) bool {
	return e.start <= nodeStart(file, b.node) && b.node.End() <= e.end && !containsWord(e.text, b.name)
}

// keepDeclaredImports returns fixes without the edits that would remove an
// import binding that declared, the declaration file's imports by
// declaredImportKey, holds. Each such fix loses every edit of that import
// declaration, so the declaration stays as written; an import the
// declaration file does not write still goes.
func keepDeclaredImports(file *ast.SourceFile, fixes []fileFix, declared map[string]bool) []fileFix {
	if len(declared) == 0 {
		return fixes
	}
	bindings := importBindingsOf(file)
	text := file.Text()
	type span struct{ start, end int }
	var kept []fileFix
	for _, f := range fixes {
		var keep []span
		for _, b := range bindings {
			module := b.declaration.ModuleSpecifier()
			if module == nil || !ast.IsStringLiteral(module) || !declared[declaredImportKey(module.Text(), b.name)] {
				continue
			}
			for _, e := range f.edits {
				if removesBinding(file, e, b) {
					start, end := nodeStart(file, b.declaration), b.declaration.End()
					if newline := strings.IndexByte(text[end:], '\n'); newline >= 0 && strings.TrimSpace(text[end:end+newline]) == "" {
						end += newline + 1
					}
					keep = append(keep, span{start, end})
					break
				}
			}
		}
		if len(keep) == 0 {
			kept = append(kept, f)
			continue
		}
		g := f
		g.edits = nil
		for _, e := range f.edits {
			inside := false
			for _, s := range keep {
				if s.start <= e.start && e.end <= s.end {
					inside = true
				}
			}
			if !inside {
				g.edits = append(g.edits, e)
			}
		}
		if len(g.edits) > 0 {
			kept = append(kept, g)
		}
	}
	return kept
}
