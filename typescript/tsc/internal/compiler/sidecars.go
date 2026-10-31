package compiler

import (
	"context"
	"regexp"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	tsdiagnostics "github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

// VibeLang: declaration sidecars. With the vibelang setting
// declarationSidecars, each .vibe module of the program also gets its
// declarations beside its source, x.d.vibe.ts for x.vibe. Stock TypeScript
// resolves an import of ./x.vibe to that file under allowArbitraryExtensions,
// as it resolves ./styles.css to styles.d.css.ts, so tsc, TypeDoc and every
// other checker built on TypeScript reads a .vibe module's types without
// VibeLang. The text is the declaration file the module emits, x.d.ts, with
// two changes that keep it right beside the source: a relative import of
// another .vibe module names its source, ./y.vibe, which resolves to
// y.d.vibe.ts, and a reference path is relative to the source's directory.
// VibeLang's own resolver prefers x.vibe to its sidecar, and a project's
// include leaves out a sidecar whose source is on disk, so the sidecars never
// stand in for the sources they describe.

// SidecarPath returns the declaration sidecar of a .vibe file: x.d.vibe.ts
// for x.vibe.
func SidecarPath(fileName string) string {
	return strings.TrimSuffix(fileName, tspath.ExtensionVibe) + ".d" + tspath.ExtensionVibe + ".ts"
}

var (
	sidecarSpecifier = regexp.MustCompile(`(?m)((?:\bfrom|^import|\bimport\(|\brequire\(|\bdeclare module)\s*)(["'])(\.\.?/[^"'\n]*)(["'])`)
	sidecarReference = regexp.MustCompile(`(?m)^(/// <reference path=)(["'])([^"']+)(["'])`)
	sourceMapComment = regexp.MustCompile(`(?m)^//# sourceMappingURL=.*\n?`)
)

// EmitDeclarationSidecars writes the declaration sidecar of each of the
// program's .vibe modules whose text changed, with write, and returns the
// declaration emit's diagnostics. A sidecar whose text is unchanged is not
// written, so a watch that includes it does not rebuild.
func (p *Program) EmitDeclarationSidecars(ctx context.Context, write func(fileName string, text string) error) []*ast.Diagnostic {
	vibelang := p.Options().VibeLang
	if vibelang == nil || !vibelang.DeclarationSidecars {
		return nil
	}
	var sources []*ast.SourceFile
	for _, file := range p.getSourceFilesToEmit(nil, true /*forceDtsEmit*/, false /*forceJsEmit*/) {
		if file.IsDeclarationFile || file.EmbeddedModule() != nil || !tspath.FileExtensionIs(string(file.FileName()), tspath.ExtensionVibe) {
			continue
		}
		sources = append(sources, file)
	}
	if len(sources) == 0 {
		return nil
	}
	fs := p.Host().FS()
	result := p.Emit(ctx, EmitOptions{
		TargetSourceFiles: sources,
		EmitOnly:          EmitOnlyDts,
		ForceEmit:         true,
		WriteFile: func(fileName tspath.RootedFilePath, text string, data *WriteFileData) error {
			if data == nil || data.SourceFile == nil || !tspath.IsDeclarationFileName(string(fileName)) {
				return nil // the declaration map
			}
			source := string(data.SourceFile.FileName())
			sidecar := SidecarPath(source)
			text = sidecarText(text, string(fileName), source, func(path string) bool { return fs.FileExists(tspath.RootedFilePathFromNormalized(path)) }, p.caseSensitivity)
			if existing, ok := fs.ReadFile(tspath.RootedFilePathFromNormalized(sidecar)); ok && existing == text {
				return nil
			}
			return write(sidecar, text)
		},
	})
	if result == nil {
		return nil
	}
	if p.Options().GetEmitDeclarations() {
		return result.Diagnostics
	}
	// A project that asks for no declarations does not fail on what a sidecar
	// cannot print: a sidecar holds what emit writes, and the checkers that
	// read it report what they need.
	var diagnostics []*ast.Diagnostic
	for _, d := range result.Diagnostics {
		warning := d.Clone()
		warning.SetCategory(tsdiagnostics.CategoryWarning)
		diagnostics = append(diagnostics, warning)
	}
	return diagnostics
}

// sidecarText turns the declaration text that declarationFile would hold for
// source into its sidecar's. exists reports whether a file is on disk.
func sidecarText(text string, declarationFile string, source string, exists func(string) bool, caseSensitivity tspath.CaseSensitivity) string {
	text = sourceMapComment.ReplaceAllString(text, "")
	sourceDirectory := tspath.GetDirectoryPath(source)
	text = sidecarSpecifier.ReplaceAllStringFunc(text, func(match string) string {
		parts := sidecarSpecifier.FindStringSubmatch(match)
		return parts[1] + parts[2] + vibeSpecifier(parts[3], sourceDirectory, exists) + parts[4]
	})
	declarationDirectory := tspath.GetDirectoryPath(declarationFile)
	if declarationDirectory != sourceDirectory {
		text = sidecarReference.ReplaceAllStringFunc(text, func(match string) string {
			parts := sidecarReference.FindStringSubmatch(match)
			target := tspath.ResolvePath(declarationDirectory, parts[3])
			relative := tspath.GetRelativePathFromDirectory(sourceDirectory, target, caseSensitivity)
			if !strings.HasPrefix(relative, ".") {
				relative = "./" + relative
			}
			return parts[1] + parts[2] + relative + parts[4]
		})
	}
	return text
}

// vibeSpecifier names a .vibe module by its source, ./y.vibe, where a
// relative specifier, ./y.js or ./y, reaches y.vibe and no TypeScript file
// that stock TypeScript would resolve first.
func vibeSpecifier(specifier string, directory string, exists func(string) bool) string {
	stem := specifier
	switch {
	case strings.HasSuffix(specifier, ".js"):
		stem = strings.TrimSuffix(specifier, ".js")
	case strings.HasSuffix(specifier, tspath.ExtensionVibe):
		return specifier
	case tspath.TryGetExtensionFromPath(specifier) != "":
		return specifier
	}
	base := tspath.ResolvePath(directory, stem)
	if !exists(base + tspath.ExtensionVibe) {
		return specifier
	}
	for _, extension := range []string{tspath.ExtensionTs, tspath.ExtensionTsx, tspath.ExtensionDts} {
		if exists(base + extension) {
			return specifier
		}
	}
	return stem + tspath.ExtensionVibe
}
