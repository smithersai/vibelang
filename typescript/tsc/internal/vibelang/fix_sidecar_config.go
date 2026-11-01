package vibelang

import (
	"bytes"
	"fmt"
	"os"
	"slices"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/execute/tsc"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/wrapvfs"
)

// sidecarConfigFixes uses the config loader's diagnostic files, including
// resolved local extends files, rather than implementing config resolution.
// Keep edits in an overlay until all source fixes and cancellation checks pass.
func sidecarConfigFixes(fs vfs.FS, errors []*ast.Diagnostic) (vfs.FS, map[tspath.RootedFilePath]string) {
	changes := map[tspath.RootedFilePath]string{}
	for _, diagnostic := range errors {
		file := diagnostic.File()
		if file == nil {
			continue
		}
		modern := diagnostic.Source() == "EK" && diagnostic.Code() == core.VibeInvalidConfigCode
		legacy := diagnostic.Code() == diagnostics.Unknown_compiler_option_0.Code()
		if !modern && !legacy {
			continue
		}
		if legacy {
			args := diagnostic.MessageArgs()
			if !slices.Contains(args, "vibelang.declarationSidecars") && !slices.Contains(args, "vibe.declarationSidecars") && !slices.Contains(args, "declarationSidecars") {
				continue
			}
		}
		name := file.FileName()
		if _, seen := changes[name]; seen || strings.Contains(name.AsString(), "/node_modules/") {
			continue
		}
		text, ok := fs.ReadFile(name)
		if !ok {
			continue
		}
		offset := 0
		if text != file.Text() {
			const bom = "\ufeff"
			if !strings.HasPrefix(text, bom) || text[len(bom):] != file.Text() {
				continue
			}
			offset = len(bom)
		}
		edits := removedSidecarSettingEdits(file)
		// VIP-30 reports unknown vibe keys as EK3007, with the key's source
		// span rather than TS5023 message arguments. Match only a removed
		// setting's range; an unrelated EK3007 must not trigger this migration.
		if modern && !slices.ContainsFunc(edits, func(edit sourceEdit) bool {
			return diagnostic.Loc().Pos() >= edit.start && diagnostic.Loc().End() <= edit.end
		}) {
			continue
		}
		if len(edits) > 0 {
			for i := range edits {
				edits[i].start += offset
				edits[i].end += offset
			}
			changes[name] = applyEdits(text, edits)
		}
	}
	if len(changes) == 0 {
		return fs, nil
	}
	return wrapvfs.Wrap(fs, wrapvfs.Replacements{
		ReadFile: func(name tspath.RootedFilePath) (string, bool) {
			if text, ok := changes[name]; ok {
				return text, true
			}
			return fs.ReadFile(name)
		},
	}), changes
}

func removedSidecarSettingEdits(file *ast.SourceFile) []sourceEdit {
	if file.Statements == nil || len(file.Statements.Nodes) == 0 || !ast.IsExpressionStatement(file.Statements.Nodes[0]) {
		return nil
	}
	root := file.Statements.Nodes[0].Expression()
	var settings []*ast.Node
	addSettings := func(object *ast.Node, allowVibe bool) {
		if object == nil || !ast.IsObjectLiteralExpression(object) {
			return
		}
		for _, property := range object.AsObjectLiteralExpression().Properties.Nodes {
			name := sidecarConfigPropertyName(property)
			if name == "vibelang" || allowVibe && name == "vibe" {
				settings = append(settings, property.AsPropertyAssignment().Initializer)
			}
		}
	}
	addSettings(root, true)
	if ast.IsObjectLiteralExpression(root) {
		for _, property := range root.AsObjectLiteralExpression().Properties.Nodes {
			if sidecarConfigPropertyName(property) == "compilerOptions" {
				addSettings(property.AsPropertyAssignment().Initializer, false)
			}
		}
	}
	var edits []sourceEdit
	for _, object := range settings {
		if object == nil || !ast.IsObjectLiteralExpression(object) {
			continue
		}
		properties := object.AsObjectLiteralExpression().Properties.Nodes
		for i, property := range properties {
			if sidecarConfigPropertyName(property) != "declarationSidecars" {
				continue
			}
			start, end := nodeStart(file, property), property.End()
			after := scanner.SkipTrivia(file.Text(), end)
			if after < len(file.Text()) && file.Text()[after] == ',' {
				end = after + 1
			} else if i > 0 {
				comma := scanner.SkipTrivia(file.Text(), properties[i-1].End())
				if comma < start && file.Text()[comma] == ',' {
					edits = append(edits, sourceEdit{comma, comma + 1, ""})
				}
			}
			edits = append(edits, sourceEdit{start, end, ""})
		}
	}
	// Duplicate obsolete keys can share a separator. Merge deletion ranges
	// before applying them so their common comma is removed only once.
	slices.SortFunc(edits, func(a, b sourceEdit) int { return a.start - b.start })
	var merged []sourceEdit
	for _, edit := range edits {
		if len(merged) > 0 && edit.start <= merged[len(merged)-1].end {
			if edit.end > merged[len(merged)-1].end {
				merged[len(merged)-1].end = edit.end
			}
		} else {
			merged = append(merged, edit)
		}
	}
	return merged
}

// writeSidecarConfigFixes writes changes; reportSidecarConfigFixes prints
// them once the fixes are done.
func writeSidecarConfigFixes(sys tsc.System, changes map[tspath.RootedFilePath]string) error {
	names := make([]tspath.RootedFilePath, 0, len(changes))
	for name := range changes {
		names = append(names, name)
	}
	slices.Sort(names)
	for _, name := range names {
		text := changes[name]
		// The compiler's filesystem decodes BOMs while reading. Preserve an
		// original UTF-8 BOM when writing the edited configuration back.
		const bom = "\ufeff"
		if original, err := os.ReadFile(name.AsString()); err == nil && bytes.HasPrefix(original, []byte(bom)) && !strings.HasPrefix(text, bom) {
			text = bom + text
		}
		if err := writeFileAtomically(name.AsString(), text); err != nil {
			return fmt.Errorf("%s: %w", relativeName(sys, name), err)
		}
	}
	return nil
}

func reportSidecarConfigFixes(sys tsc.System, changes map[tspath.RootedFilePath]string) {
	names := make([]tspath.RootedFilePath, 0, len(changes))
	for name := range changes {
		names = append(names, name)
	}
	slices.Sort(names)
	for _, name := range names {
		fmt.Fprintf(sys.Writer(), "vibelang --fix: %s: removed obsolete declarationSidecars setting\n", relativeName(sys, name))
	}
}

func sidecarConfigPropertyName(property *ast.Node) string {
	if !ast.IsPropertyAssignment(property) {
		return ""
	}
	name := property.Name()
	if name != nil && (ast.IsIdentifier(name) || ast.IsStringLiteral(name)) {
		return name.Text()
	}
	return ""
}
