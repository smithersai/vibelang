package vibelang

import (
	"fmt"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
)

// Detail 296: retire native-extension fallback only after its preserving
// migration ships. A native file always wins; the ordinary fix gate verifies
// each proposed edit in the same project.
func staleSpecifierFixes(program *compiler.Program, file *ast.SourceFile, refused map[string]bool) proposal {
	p := proposal{file: file}
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if ast.IsStringLiteralLike(node) && isModuleSpecifier(node) {
			written := node.Text()
			sourceExt, vibeExt := ".ts", ".vibe"
			if strings.HasSuffix(written, ".tsx") {
				sourceExt, vibeExt = ".tsx", ".vibex"
			}
			if (strings.HasPrefix(written, "./") || strings.HasPrefix(written, "../")) && strings.HasSuffix(written, sourceExt) {
				base := strings.TrimSuffix(written, sourceExt)
				resolved := program.GetResolvedModuleFromModuleSpecifier(file, node)
				migrated := resolved != nil && resolved.IsResolved() && strings.HasSuffix(resolved.ResolvedFileName.AsString(), vibeExt)
				// After retirement a stale name is unresolved. Use the same
				// project resolver for its source spelling, including rootDirs
				// and moduleSuffixes, instead of guessing a physical sibling.
				if !migrated && (resolved == nil || !resolved.IsResolved()) {
					target := program.ResolveModuleNameForFile(base+vibeExt, file)
					migrated = target != nil && target.IsResolved() && strings.HasSuffix(target.ResolvedFileName.AsString(), vibeExt)
				}
				if migrated {
					ext := ".js"
					if vibeExt == ".vibex" && program.Options().Jsx == core.JsxEmitPreserve {
						ext = ".jsx"
					}
					if program.Options().RewriteRelativeImportExtensions.IsTrue() ||
						(program.Options().AllowImportingTsExtensions.IsTrue() && (program.Options().NoEmit.IsTrue() || program.Options().EmitDeclarationOnly.IsTrue())) {
						ext = vibeExt
					}
					start := nodeStart(file, node) + 1
					key := fmt.Sprintf("stale-specifier:%s:%d", file.FileName(), start)
					if !refused[key] {
						p.fixes = append(p.fixes, fileFix{label: "stale module specifiers", key: key,
							edits: []sourceEdit{{start, node.End() - 1, base + ext}}})
					}
				}
			}
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
	return p
}

func isModuleSpecifier(node *ast.Node) bool {
	parent := node.Parent
	if parent == nil {
		return false
	}
	if ast.IsImportDeclaration(parent) || ast.IsExportDeclaration(parent) {
		return parent.ModuleSpecifier() == node
	}
	if ast.IsExternalModuleReference(parent) {
		return true
	}
	if ast.IsLiteralTypeNode(parent) && parent.Parent != nil && ast.IsImportTypeNode(parent.Parent) {
		return true
	}
	if ast.IsCallExpression(parent) {
		call := parent.AsCallExpression()
		return call.Expression.Kind == ast.KindImportKeyword && call.Arguments != nil && len(call.Arguments.Nodes) > 0 && call.Arguments.Nodes[0] == node
	}
	return false
}
