package compiler

import (
	"context"
	"regexp"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/printer"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs"
)

// VibeLang compatibility declarations use TypeScript's .d.<ext>.ts naming.
// Default output is beside each source; vibe.sidecarDir mirrors the source
// tree under one output directory (268/271). Relative module specifiers and
// reference paths resolve from the final sidecar location, independently of
// a consumer's config. VibeLang's resolver still prefers the matching source.

// SidecarPath returns the declaration sidecar of a .vibe file beside it:
// x.d.vibe.ts for x.vibe.
func SidecarPath(fileName string) string {
	return strings.TrimSuffix(fileName, tspath.ExtensionVibe) + ".d" + tspath.ExtensionVibe + ".ts"
}

var (
	sidecarReference = regexp.MustCompile(`(?m)^(/// <reference path=)(["'])([^"']+)(["'])`)
	sourceMapComment = regexp.MustCompile(`(?m)^//# sourceMappingURL=.*\n?`)
)

// EmitDeclarationSidecars writes the declaration sidecar of each of the
// program's .vibe modules whose text changed, with write, and returns the
// declaration emit's diagnostics. A sidecar whose text is unchanged is not
// written, so a watch that includes it does not rebuild. With output, the
// file system the sidecars go to, it also deletes each module's sidecar from
// the place the other layout puts it, so switching vibe.sidecarDir on or off
// leaves one sidecar per module.
func (p *Program) EmitDeclarationSidecars(ctx context.Context, write func(fileName string, text string) error, outputs ...vfs.FS) []*ast.Diagnostic {
	var output vfs.FS
	if len(outputs) != 0 {
		output = outputs[0]
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
	// Overlapping roots can make one module's old colocated sidecar another
	// module's selected output. Cleanup must not remove any selected output,
	// regardless of the order in which the sources emit.
	selected := make(map[tspath.PathKey]bool, len(sources))
	for _, file := range sources {
		sidecar, _ := p.Options().VibeSidecarPaths(string(file.FileName()), p.caseSensitivity)
		selected[p.PathKeyForFileName(tspath.RootedFilePathFromNormalized(sidecar))] = true
	}
	fs := p.Host().FS()
	resolver := p.newResolver()
	result := p.Emit(ctx, EmitOptions{
		VibeDeclarationSidecar: true,
		TargetSourceFiles:      sources,
		EmitOnly:               EmitOnlyDts,
		ForceEmit:              true,
		WriteFile: func(fileName tspath.RootedFilePath, text string, data *WriteFileData) error {
			if data == nil || data.SourceFile == nil || !tspath.IsDeclarationFileName(string(fileName)) {
				return nil // the declaration map
			}
			source := string(data.SourceFile.FileName())
			sidecar, stale := p.Options().VibeSidecarPaths(source, p.caseSensitivity)
			if output != nil && stale != "" && !selected[p.PathKeyForFileName(tspath.RootedFilePathFromNormalized(stale))] && output.FileExists(tspath.RootedFilePathFromNormalized(stale)) {
				if err := output.Remove(tspath.RootedPathFromNormalized(stale)); err != nil {
					return err
				}
				p.pruneSidecarDirectories(tspath.GetDirectoryPath(stale), output)
			}
			// Resolve from the source using the real module resolver, then write
			// relative to the final compatibility output. Another project's
			// checker never inherits this project's rootDirs (opencode-53).
			resolve := func(specifier string) string {
				resolved, _, _ := resolver.ResolveModuleName(specifier, data.SourceFile.FileName(), p.GetDefaultResolutionModeForFile(data.SourceFile), nil)
				if resolved != nil && resolved.Extension == tspath.ExtensionVibe {
					target, _ := p.Options().VibeSidecarPaths(string(resolved.ResolvedFileName), p.caseSensitivity)
					return strings.TrimSuffix(target, ".d"+tspath.ExtensionVibe+".ts") + tspath.ExtensionVibe
				}
				return tspath.ResolvePath(tspath.GetDirectoryPath(source), specifier)
			}
			text = relocatedSidecarText(text, string(fileName), tspath.GetDirectoryPath(sidecar), resolve, p.caseSensitivity)
			if existing, ok := fs.ReadFile(tspath.RootedFilePathFromNormalized(sidecar)); ok && existing == text {
				return nil
			}
			return write(sidecar, text)
		},
	})
	if result == nil {
		return nil
	}
	// What a sidecar cannot print is an error where the project declares its
	// modules: emit writes any in its place, such as TS7056's fallback for a
	// type too long to serialize, and the stock checkers that read the sidecar
	// accept that any without a word, so a consumer would lose the module's
	// types.
	if p.Options().GetEmitDeclarations() {
		return result.Diagnostics
	}
	return p.sidecarReaderDiagnostics(result.Diagnostics, sources)
}

// sidecarReaderDiagnostics keeps, of what the sidecars of a project with no
// declaration output cannot print, what a reader sees. That project's
// TypeScript, compiled with tsc, reports no TS2883 for an export whose type
// it cannot name (foldkit-33: an app's AppTabs = Tabs.create<…>()), since
// only declaration emit names it, so its .vibe version must not fail either.
// The one reader of such a sidecar is a .ts file of the project that imports
// the module, through the sidecar, under every checker but VibeLang's: each
// diagnostic is reported at each such import, with the export it concerns as
// related information, and dropped when there is none.
func (p *Program) sidecarReaderDiagnostics(reported []*ast.Diagnostic, sources []*ast.SourceFile) []*ast.Diagnostic {
	vibe := map[*ast.SourceFile]bool{}
	for _, source := range sources {
		vibe[source] = true
	}
	imports := map[*ast.SourceFile][]*ast.Diagnostic{} // a .vibe module -> where .ts files import it
	for _, file := range p.GetSourceFiles() {
		if file.IsDeclarationFile || vibe[file] || tspath.FileExtensionIs(string(file.FileName()), tspath.ExtensionVibe) {
			continue
		}
		for _, specifier := range file.Imports() {
			resolved := p.GetResolvedModuleFromModuleSpecifier(file, specifier)
			if !resolved.IsResolved() {
				continue
			}
			if target := p.GetSourceFile(resolved.ResolvedFileName); target != nil && vibe[target] {
				imports[target] = append(imports[target], ast.NewDiagnostic(file, scanner.GetRangeOfTokenAtPosition(file, specifier.Pos()), diagnostics.X_0_was_imported_here, specifier.Text()))
			}
		}
	}
	var kept []*ast.Diagnostic
	for _, d := range reported {
		if d.File() == nil || !vibe[d.File()] {
			kept = append(kept, d)
			continue
		}
		for _, at := range imports[d.File()] {
			kept = append(kept, ast.NewDiagnosticFromSerialized(at.File(), at.Loc(), d.Code(), d.Category(), d.MessageKey(), d.MessageArgs(), d.MessageChain(), append([]*ast.Diagnostic{d}, d.RelatedInformation()...), d.ReportsUnnecessary(), d.ReportsDeprecated(), d.SkippedOnNoEmit()))
		}
	}
	return kept
}

// pruneSidecarDirectories removes directory and its ancestors while they are
// empty, inside the conventional sidecar directory's .vibe folder only, after
// a mode switch removed the last stale sidecar there.
func (p *Program) pruneSidecarDirectories(directory string, output vfs.FS) {
	configFile := p.Options().ConfigFilePath
	if configFile == "" {
		return
	}
	hidden := tspath.GetDirectoryPath(tspath.CombinePaths(configFile.Directory().AsString(), core.VibeConventionalSidecarDir))
	for tspath.ContainsPath(hidden, directory, p.caseSensitivity) {
		entries := output.GetAccessibleEntries(tspath.RootedDirectoryPathFromNormalized(directory))
		if len(entries.Files) != 0 || len(entries.Directories) != 0 || output.Remove(tspath.RootedPathFromNormalized(directory)) != nil || directory == hidden {
			return
		}
		directory = tspath.GetDirectoryPath(directory)
	}
}

// relocatedSidecarText writes every relative module reference from the final sidecar
// directory, using resolve's absolute logical target. Triple-slash paths are
// rebased from the public declaration output; source-map comments are removed.
func relocatedSidecarText(text string, declarationFile string, sidecarDirectory string, resolve func(string) string, caseSensitivity tspath.CaseSensitivity) string {
	text = sourceMapComment.ReplaceAllString(text, "")
	text = rewriteSidecarSpecifiers(text, func(specifier string) string {
		if !tspath.IsExternalModuleNameRelative(specifier) {
			return specifier
		}
		target := resolve(specifier)
		relative := tspath.GetRelativePathFromDirectory(sidecarDirectory, target, caseSensitivity)
		if !tspath.IsExternalModuleNameRelative(relative) {
			relative = "./" + relative
		}
		return relative
	})
	declarationDirectory := tspath.GetDirectoryPath(declarationFile)
	if declarationDirectory != sidecarDirectory {
		text = sidecarReference.ReplaceAllStringFunc(text, func(match string) string {
			parts := sidecarReference.FindStringSubmatch(match)
			target := tspath.ResolvePath(declarationDirectory, parts[3])
			relative := tspath.GetRelativePathFromDirectory(sidecarDirectory, target, caseSensitivity)
			if !tspath.IsExternalModuleNameRelative(relative) {
				relative = "./" + relative
			}
			return parts[1] + parts[2] + relative + parts[4]
		})
	}
	return text
}

// sidecarText turns the declaration text that declarationFile would hold for
// source into its sidecar's. exists reports whether a file is on disk.
func sidecarText(text string, declarationFile string, source string, exists func(string) bool, caseSensitivity tspath.CaseSensitivity) string {
	text = sourceMapComment.ReplaceAllString(text, "")
	sourceDirectory := tspath.GetDirectoryPath(source)
	text = rewriteSidecarSpecifiers(text, func(specifier string) string {
		return vibeSpecifier(specifier, sourceDirectory, exists)
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
// relative specifier, ./y.js, ./y or ./y.ts (each a
// vibelang.declarationImportStyle), reaches y.vibe and no TypeScript file that
// stock TypeScript would resolve first. Explicit .vibe specifiers have already
// been preserved by declaration emit, so native siblings cannot hide them.
func vibeSpecifier(specifier string, directory string, exists func(string) bool) string {
	stem := specifier
	switch {
	case strings.HasSuffix(specifier, ".js"):
		stem = strings.TrimSuffix(specifier, ".js")
	case strings.HasSuffix(specifier, tspath.ExtensionTs) && !tspath.IsDeclarationFileName(specifier):
		stem = strings.TrimSuffix(specifier, tspath.ExtensionTs)
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

// rewriteSidecarSpecifiers reads declaration module names as TypeScript
// string values. Keep all other declaration bytes, including quote style;
// only a rewritten path needs to be printed and escaped again.
func rewriteSidecarSpecifiers(text string, rewrite func(string) string) string {
	file := parser.ParseSourceFile(ast.SourceFileParseOptions{
		FileName: "/sidecar.d.ts",
		PathKey:  "/sidecar.d.ts",
	}, text, core.ScriptKindTS)
	var result strings.Builder
	end := 0
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		var specifier *ast.Node
		switch node.Kind {
		case ast.KindImportDeclaration:
			specifier = node.AsImportDeclaration().ModuleSpecifier
		case ast.KindExportDeclaration:
			specifier = node.AsExportDeclaration().ModuleSpecifier
		case ast.KindExternalModuleReference:
			specifier = node.AsExternalModuleReference().Expression
		case ast.KindImportType:
			if argument := node.AsImportTypeNode().Argument; argument != nil && ast.IsLiteralTypeNode(argument) {
				specifier = argument.AsLiteralTypeNode().Literal
			}
		case ast.KindModuleDeclaration:
			specifier = node.Name()
		}
		if specifier != nil && ast.IsStringLiteral(specifier) && tspath.IsExternalModuleNameRelative(specifier.Text()) {
			value := specifier.Text()
			if rewritten := rewrite(value); rewritten != value {
				start := scanner.GetTokenPosOfNode(specifier, file, false /*includeJSDoc*/)
				quote := text[start]
				result.WriteString(text[end:start])
				result.WriteByte(quote)
				result.WriteString(printer.EscapeString(rewritten, printer.QuoteChar(quote)))
				result.WriteByte(quote)
				end = specifier.End()
			}
		}
		return node.ForEachChild(visit)
	}
	visit(file.AsNode())
	if end == 0 {
		return text
	}
	result.WriteString(text[end:])
	return result.String()
}
