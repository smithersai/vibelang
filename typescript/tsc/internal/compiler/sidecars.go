package compiler

import (
	"context"
	"regexp"
	"strings"
	"sync"
	"sync/atomic"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/outputpaths"
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

// SidecarPath returns the declaration sidecar of a VibeLang file beside it:
// x.d.vibe.ts for x.vibe and x.d.vibex.ts for x.vibex.
func SidecarPath(fileName string) string {
	extension := tspath.VibeLangSourceExtension(fileName)
	return strings.TrimSuffix(fileName, extension) + ".d" + extension + ".ts"
}

// Sidecar output follows declarationDir's source-root rules in TypeScript 5.9:
// explicit rootDir, the config directory for composite projects, otherwise the
// common directory of emitted sources. Declaration inputs and referenced projects
// do not widen that root.
func (p *Program) vibeSidecarPaths(source string) (string, string) {
	if referenced := p.GetProjectReferenceFromSource(p.PathKeyForFileName(tspath.RootedFilePathFromNormalized(source))); referenced != nil {
		config := referenced.Resolved
		options := config.CompilerOptions()
		return options.VibeSidecarPaths(source, p.caseSensitivity, options.VibeSidecarRoot(config.FileNames(), p.caseSensitivity))
	}
	return p.vibeSidecarOptions().VibeSidecarPaths(source, p.caseSensitivity, p.vibeSidecarSourceRoot())
}

func (p *Program) vibeSidecarOptions() *core.CompilerOptions {
	if p.sidecarProjectOptions != nil {
		return p.sidecarProjectOptions
	}
	return p.Options()
}

func (p *Program) vibeSidecarSourceRoot() string {
	p.sidecarSourceDirectoryOnce.Do(func() {
		var files []tspath.RootedFilePath
		for _, file := range p.files {
			if !file.IsDeclarationFile && sourceFileMayBeEmitted(file, p, true, false) {
				files = append(files, file.FileName())
			}
		}
		p.sidecarSourceDirectory = p.vibeSidecarOptions().VibeSidecarRoot(files, p.caseSensitivity)
	})
	return p.sidecarSourceDirectory
}

var (
	sidecarReference = regexp.MustCompile(`(?m)^(/// <reference path=)(["'])([^"']+)(["'])`)
	sourceMapComment = regexp.MustCompile(`(?m)^//# sourceMappingURL=.*\n?`)
)

// EmitDeclarationSidecars writes the declaration sidecar of each of the
// program's .vibe modules whose text changed, with write, and returns the
// declaration emit's result. A sidecar whose text is unchanged is not
// written, so a watch that includes it does not rebuild. With output, the
// file system the sidecars go to, it also deletes each module's sidecar from
// the place the other layout puts it, so switching vibe.sidecarDir on or off
// leaves one sidecar per module.
//
// A module declaration's body has no sidecar of its own. A sidecar that refers
// to one, ./main.vibe.parse.js, reaches TypeScript's declaration of the body,
// which it also writes beside that sidecar (VIP-40), so that a checker without
// the .vibe file resolves it from the sidecar's own location.
func (p *Program) EmitDeclarationSidecars(ctx context.Context, write func(fileName string, text string) error, outputs ...vfs.FS) *EmitResult {
	var output vfs.FS
	if len(outputs) != 0 {
		output = outputs[0]
	}
	sources := p.declarationSidecarSources()
	if len(sources) == 0 {
		return nil
	}
	// Private project emission may serve unaffected modules despite errors.
	// Compatibility declarations are shared project outputs: publish them only
	// after checking and declaration serialization both succeed.
	if projectSidecarOptions {
		diagnostics := GetDiagnosticsOfAnyProgram(ctx, p, nil, true, p.GetBindDiagnostics, p.GetSemanticDiagnostics)
		if ctx.Err() != nil || diagnosticsAffectBuild(diagnostics) {
			return &EmitResult{EmitSkipped: true}
		}
	}
	// Overlapping roots can make one module's old colocated sidecar another
	// module's selected output. Cleanup must not remove any selected output,
	// regardless of the order in which the sources emit.
	selected := make(map[tspath.PathKey]bool, len(sources))
	for _, file := range sources {
		sidecar, _ := p.vibeSidecarPaths(string(file.FileName()))
		selected[p.PathKeyForFileName(tspath.RootedFilePathFromNormalized(sidecar))] = true
	}
	bodies := map[string]*ast.SourceFile{} // a body's file name, without its extension
	for _, file := range sources {
		for _, body := range file.EmbeddedModules() {
			bodies[tspath.RemoveFileExtension(string(body.FileName()))] = body
		}
	}
	var publication []func() error
	var publicationMutex sync.Mutex
	publish := func(action func() error) error {
		if !projectSidecarOptions {
			return action()
		}
		publicationMutex.Lock()
		defer publicationMutex.Unlock()
		publication = append(publication, action)
		return nil
	}
	var mutex sync.Mutex
	var referenced []*ast.SourceFile
	visited := map[*ast.SourceFile]bool{}
	// refer records the body a relative specifier names, in any of the
	// spellings of vibelang.declarationImportStyle: ./main.vibe.parse.js,
	// ./main.vibe.parse or ./main.vibe.parse.ts.
	bodyAt := func(target string) *ast.SourceFile {
		if body := bodies[target]; body != nil {
			return body
		}
		return bodies[tspath.RemoveFileExtension(target)]
	}
	refer := func(target string) {
		body := bodyAt(target)
		if body == nil {
			return
		}
		mutex.Lock()
		defer mutex.Unlock()
		if !visited[body] {
			visited[body] = true
			referenced = append(referenced, body)
		}
	}
	fs := p.Host().FS()
	resolver := p.newResolver()
	var blocked atomic.Bool
	emit := func(targets []*ast.SourceFile) *EmitResult {
		return p.Emit(ctx, EmitOptions{
			VibeDeclarationSidecar: true,
			TargetSourceFiles:      targets,
			EmitOnly:               EmitOnlyDts,
			ForceEmit:              true,
			WriteFile: func(fileName tspath.RootedFilePath, text string, data *WriteFileData) error {
				if data == nil || data.SourceFile == nil || !tspath.IsDeclarationFileName(string(fileName)) {
					return nil // the declaration map
				}
				source := string(data.SourceFile.FileName())
				isBody := data.SourceFile.EmbeddedModule() != nil
				var sidecar, stale string
				if isBody {
					sidecar, stale = p.moduleBodyDeclarationPaths(data.SourceFile)
					// The other layout's place may be the project's own declaration
					// output or an input; neither is a stale copy.
					if stale != "" && (p.emitsDeclarationAt(data.SourceFile, stale) || p.GetSourceFile(tspath.RootedFilePathFromNormalized(stale)) != nil) {
						stale = ""
					}
				} else {
					sidecar, stale = p.vibeSidecarPaths(source)
				}
				if p.IsEmitBlocked(tspath.RootedFilePathFromNormalized(sidecar)) {
					blocked.Store(true)
					return nil
				}
				if output != nil && stale != "" && !selected[p.PathKeyForFileName(tspath.RootedFilePathFromNormalized(stale))] && output.FileExists(tspath.RootedFilePathFromNormalized(stale)) {
					if err := publish(func() error {
						if err := output.Remove(tspath.RootedPathFromNormalized(stale)); err != nil {
							return err
						}
						p.pruneSidecarDirectories(tspath.GetDirectoryPath(stale), output)
						return nil
					}); err != nil {
						return err
					}
				}
				// Resolve from the source using the real module resolver, then write
				// relative to the final compatibility output. Another project's
				// checker never inherits this project's rootDirs (opencode-53).
				resolve := func(specifier string) string {
					target := tspath.ResolvePath(tspath.GetDirectoryPath(source), specifier)
					refer(target)
					// A body's declaration sits beside its file's sidecar.
					if body := bodyAt(target); body != nil {
						declaration, _ := p.moduleBodyDeclarationPaths(body)
						return tspath.CombinePaths(tspath.GetDirectoryPath(declaration), tspath.GetBaseFileName(target))
					}
					resolved, _, _ := resolver.ResolveModuleName(specifier, data.SourceFile.FileName(), p.GetDefaultResolutionModeForFile(data.SourceFile), nil)
					// A body's declaration sits beside the sidecars, so it names a
					// VibeLang module where the sidecars name it. A .vibex target,
					// however the import spells it, is named by its own compatibility
					// declaration exactly as a .vibe target is.
					// A written ./App.jsx or ./App names App.vibex by its source too.
					if resolved != nil && (resolved.Extension == tspath.ExtensionVibe || resolved.Extension == tspath.ExtensionVibex) {
						target, _ := p.vibeSidecarPaths(string(resolved.ResolvedFileName))
						return strings.TrimSuffix(target, ".d"+resolved.Extension+".ts") + resolved.Extension
					}
					return tspath.ResolvePath(tspath.GetDirectoryPath(source), specifier)
				}
				text = relocatedSidecarText(text, string(fileName), tspath.GetDirectoryPath(sidecar), resolve, p.caseSensitivity)
				// The project's own declaration output owns this path, and its
				// specifiers serve both the sidecar and a reader of its .d.ts.
				if isBody && p.emitsDeclarationAt(data.SourceFile, sidecar) {
					return nil
				}
				if existing, ok := fs.ReadFile(tspath.RootedFilePathFromNormalized(sidecar)); ok && existing == text {
					return nil
				}
				return publish(func() error { return write(sidecar, text) })
			},
		})
	}
	result := emit(sources)
	if result == nil {
		return nil
	}
	// A body's declaration can refer to another body, through an inferred type.
	for len(referenced) != 0 {
		targets := referenced
		referenced = nil
		result = CombineEmitResults([]*EmitResult{result, emit(targets)})
	}
	// What a sidecar cannot print is an error where the project declares its
	// modules: emit writes any in its place, such as TS7056's fallback for a
	// type too long to serialize, and the stock checkers that read the sidecar
	// accept that any without a word, so a consumer would lose the module's
	// types.
	if !p.Options().GetEmitDeclarations() {
		result.Diagnostics = p.sidecarReaderDiagnostics(result.Diagnostics, sources)
	}
	result.EmitSkipped = result.EmitSkipped || blocked.Load()
	if projectSidecarOptions {
		if ctx.Err() != nil || result.EmitSkipped || diagnosticsAffectBuild(result.Diagnostics) {
			result.EmitSkipped = true
			return result
		}
		for _, action := range publication {
			if err := action(); err != nil {
				result.EmitSkipped = true
				result.Diagnostics = append(result.Diagnostics, ast.NewCompilerDiagnostic(diagnostics.Could_not_write_file_0_Colon_1, "compatibility declaration", err.Error()))
				break
			}
		}
	}
	return result
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
		if file.IsDeclarationFile || vibe[file] || file.FileName().IsVibeLangSource() {
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
		file := d.File()
		if file != nil && file.EmbeddedModule() != nil {
			file = file.CanonicalSourceFile() // a body is read through its .vibe file's sidecar
		}
		if file == nil || !vibe[file] {
			kept = append(kept, d)
			continue
		}
		for _, at := range imports[file] {
			kept = append(kept, ast.NewDiagnosticFromSerialized(at.File(), at.Loc(), d.Code(), d.Category(), d.MessageKey(), d.MessageArgs(), d.MessageChain(), append([]*ast.Diagnostic{d}, d.RelatedInformation()...), d.ReportsUnnecessary(), d.ReportsDeprecated(), d.SkippedOnNoEmit()))
		}
	}
	return kept
}

// declarationSidecarSources is shared by output-path validation and emit.
func (p *Program) declarationSidecarSources() []*ast.SourceFile {
	var sources []*ast.SourceFile
	for _, file := range p.getSourceFilesToEmit(nil, true /*forceDtsEmit*/, false /*forceJsEmit*/) {
		if file.IsDeclarationFile || file.EmbeddedModule() != nil || !file.FileName().IsVibeLangSource() {
			continue
		}
		sources = append(sources, file)
	}
	return sources
}

// moduleBodyDeclarationPaths returns where a module declaration's body writes
// the declaration its .vibe file's sidecar reaches, beside that sidecar
// (VIP-40): main.vibe.parse.d.ts beside main.vibe by default, or at the
// mirrored path under vibe.sidecarDir. The second path is where the other
// layout puts it, or "".
func (p *Program) moduleBodyDeclarationPaths(body *ast.SourceFile) (string, string) {
	sidecar, stale := p.vibeSidecarPaths(string(body.CanonicalSourceFile().FileName()))
	name := tspath.GetBaseFileName(tspath.RemoveFileExtension(string(body.FileName()))) + tspath.ExtensionDts
	path := tspath.CombinePaths(tspath.GetDirectoryPath(sidecar), name)
	if stale == "" {
		return path, ""
	}
	return path, tspath.CombinePaths(tspath.GetDirectoryPath(stale), name)
}

// emitsDeclarationAt reports whether the project's ordinary emit writes file's
// declaration to path.
func (p *Program) emitsDeclarationAt(file *ast.SourceFile, path string) bool {
	options := p.Options()
	if options.NoEmit.IsTrue() || !options.GetEmitDeclarations() {
		return false
	}
	declaration := outputpaths.GetOutputPathsFor(file, options, p, outputpaths.ForceEmitPaths{}).DeclarationFilePath()
	return p.PathKeyForFileName(declaration) == p.PathKeyForFileName(tspath.RootedFilePathFromNormalized(path))
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

	return rewriteSidecarDirectives(text, tspath.GetDirectoryPath(declarationFile), sidecarDirectory, caseSensitivity)
}

func rewriteSidecarDirectives(text, declarationDirectory, sidecarDirectory string, caseSensitivity tspath.CaseSensitivity) string {
	if !strings.Contains(text, "//# sourceMappingURL=") &&
		(declarationDirectory == sidecarDirectory || !strings.Contains(text, "/// <reference path=")) {
		return text
	}
	return rewriteSidecarComments(text, func(comment string) string {
		if sourceMapComment.MatchString(comment) {
			return ""
		}
		if declarationDirectory == sidecarDirectory {
			return comment
		}
		return sidecarReference.ReplaceAllStringFunc(comment, func(match string) string {
			parts := sidecarReference.FindStringSubmatch(match)
			target := tspath.ResolvePath(declarationDirectory, parts[3])
			relative := tspath.GetRelativePathFromDirectory(sidecarDirectory, target, caseSensitivity)
			if !tspath.IsExternalModuleNameRelative(relative) {
				relative = "./" + relative
			}
			return parts[1] + parts[2] + relative + parts[4]
		})
	})
}

// sidecarText turns the declaration text that declarationFile would hold for
// source into its sidecar's. exists reports whether a file is on disk.
func sidecarText(text string, declarationFile string, source string, exists func(string) bool, caseSensitivity tspath.CaseSensitivity) string {
	sourceDirectory := tspath.GetDirectoryPath(source)
	text = rewriteSidecarSpecifiers(text, func(specifier string) string {
		return vibeSpecifier(specifier, sourceDirectory, exists)
	})
	return rewriteSidecarDirectives(text, tspath.GetDirectoryPath(declarationFile), sourceDirectory, caseSensitivity)
}

// vibeSpecifier names a .vibe module by its source, ./y.vibe, where a
// relative specifier, ./y.js, ./y or ./y.ts, reaches y.vibe and no TypeScript
// file that stock TypeScript would resolve first. Explicit .vibe specifiers have already
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

// rewriteSidecarComments visits only actual single-line comments. Mask literal
// tokens using the parsed declaration tree before scanning: a template's middle
// or tail can contain comment-looking text after an interpolation, which a
// context-free scan would otherwise mistake for a comment.
func rewriteSidecarComments(text string, rewrite func(string) string) string {
	file := parser.ParseSourceFile(ast.SourceFileParseOptions{
		FileName: "/sidecar.d.ts",
		PathKey:  "/sidecar.d.ts",
	}, text, core.ScriptKindTS)
	masked := []byte(text)
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if ast.IsStringLiteral(node) || ast.IsTemplateLiteralToken(node) {
			start := scanner.GetTokenPosOfNode(node, file, false /*includeJSDoc*/)
			for i := start; i < node.End(); i++ {
				// Preserve byte offsets and line boundaries for the scanner.
				if masked[i] != '\n' && masked[i] != '\r' {
					masked[i] = ' '
				}
			}
			return false
		}
		return node.ForEachChild(visit)
	}
	visit(file.AsNode())
	scan := scanner.NewScanner()
	scan.SetText(string(masked))
	scan.SetSkipTrivia(false)
	var result strings.Builder
	end := 0
	for token := scan.Scan(); token != ast.KindEndOfFile; token = scan.Scan() {
		if token != ast.KindSingleLineCommentTrivia {
			continue
		}
		start, stop := scan.TokenStart(), scan.TokenEnd()
		comment := text[start:stop]
		if replacement := rewrite(comment); replacement != comment {
			result.WriteString(text[end:start])
			result.WriteString(replacement)
			if replacement == "" {
				// A removed source map owns its terminating line break.
				if stop < len(text) && text[stop] == '\r' {
					stop++
				}
				if stop < len(text) && text[stop] == '\n' {
					stop++
				}
			}
			end = stop
		}
	}
	if end == 0 {
		return text
	}
	result.WriteString(text[end:])
	return result.String()
}
