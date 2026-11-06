package compiler

import (
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/module"
	"github.com/microsoft/TypeScript/tsc/internal/outputpaths"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/tracing"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

// resolveModuleBodyImport recognizes only a body's verified virtual source.
// Written declaration imports, physical TypeScript sources, and declarations
// without a matching body keep their ordinary resolution and overwrite guards.
func (p *fileLoader) resolveModuleBodyImport(name string, from tspath.RootedFilePath, resolved *module.ResolvedModule, options *core.CompilerOptions, mode core.ResolutionMode) (*module.ResolvedModule, tspath.RootedFilePath) {
	if !tspath.PathIsRelative(name) || tspath.IsDeclarationFileName(name) {
		return resolved, ""
	}
	kind := options.GetModuleResolutionKind()
	writtenExtension := strings.HasSuffix(name, ".ts") || strings.HasSuffix(name, ".tsx") || strings.HasSuffix(name, ".js") || strings.HasSuffix(name, ".jsx")
	if !writtenExtension && mode == core.ResolutionModeESM && (kind == core.ModuleResolutionKindNode16 || kind == core.ModuleResolutionKindNodeNext) {
		return resolved, ""
	}
	target := tspath.ResolvePath(tspath.GetDirectoryPath(string(from)), name)
	if resolved.IsResolved() {
		if resolved.Extension != tspath.ExtensionDts {
			return resolved, ""
		}
		target = strings.TrimSuffix(string(resolved.ResolvedFileName), tspath.ExtensionDts)
	} else {
		for _, ext := range []string{tspath.ExtensionTsx, tspath.ExtensionTs, tspath.ExtensionJsx, tspath.ExtensionJs} {
			if strings.HasSuffix(target, ext) {
				target = strings.TrimSuffix(target, ext)
				break
			}
		}
	}
	dot := strings.LastIndexByte(target, '.')
	if dot <= strings.LastIndexByte(target, '/') || !tspath.IsVibeLangSource(target[:dot]) {
		return resolved, ""
	}
	owner := tspath.RootedFilePathFromNormalized(target[:dot])
	text, ok := p.host.FS().ReadFile(owner)
	if !ok {
		return resolved, ""
	}
	parsed := parser.ParseSourceFile(ast.SourceFileParseOptions{
		FileName: owner, PathKey: p.toPath(owner.AsPath()),
	}, text, core.GetScriptKindFromFileName(owner))
	for _, body := range parsed.EmbeddedModules() {
		if tspath.RemoveFileExtension(string(body.FileName())) != target || p.host.FS().FileExists(body.FileName()) {
			continue
		}
		result := &module.ResolvedModule{}
		if resolved != nil {
			*result = *resolved
		}
		result.ResolvedFileName = body.FileName()
		result.ResolvedPath = body.PathKey()
		result.OriginalPath = ""
		result.Extension = tspath.GetAnyExtensionFromPath(string(body.FileName()), nil, tspath.CaseSensitive)
		return result, owner
	}
	return resolved, ""
}

// A project-reference declaration resolves from its source directory first.
// A body's output has no ordinary root-file entry. Recover its owning source
// through the reference output map, then verify the actual body and emit path.
func (p *fileLoader) isProjectReferenceModuleBodyOutput(name string, emitted *module.ResolvedModule) bool {
	if tspath.IsDeclarationFileName(name) || emitted == nil || !emitted.IsResolved() || emitted.Extension != tspath.ExtensionDts {
		return false
	}
	target := strings.TrimSuffix(string(emitted.ResolvedFileName), tspath.ExtensionDts)
	baseStart := strings.LastIndexByte(target, '/') + 1
	for _, extension := range []string{tspath.ExtensionVibe, tspath.ExtensionVibex} {
		for offset := baseStart; offset < len(target); {
			index := strings.Index(target[offset:], extension+".")
			if index < 0 {
				break
			}
			index += offset
			offset = index + 1
			ownerOutput := tspath.RootedFilePathFromNormalized(target[:index] + tspath.ExtensionDts)
			owner := p.projectReferences.getProjectReferenceFromOutputDts(p.toPath(ownerOutput.AsPath()))
			if owner == nil || !owner.Source.IsVibeLangSource() || !strings.HasSuffix(string(owner.Source), extension) {
				continue
			}
			text, ok := p.host.FS().ReadFile(owner.Source)
			if !ok {
				continue
			}
			parsed := parser.ParseSourceFile(ast.SourceFileParseOptions{
				FileName: owner.Source, PathKey: p.toPath(owner.Source.AsPath()),
			}, text, core.GetScriptKindFromFileName(owner.Source))
			for _, body := range parsed.EmbeddedModules() {
				if p.host.FS().FileExists(body.FileName()) {
					continue
				}
				output := outputpaths.GetOutputDeclarationFileNameWorker(body.FileName(), owner.Resolved.CompilerOptions(), owner.Resolved)
				if p.toPath(output.AsPath()) == emitted.ResolvedPath {
					if p.tracing != nil {
						p.tracing.Instant(tracing.PhaseProgram, "vibeProjectReferenceBodyOutput", map[string]any{
							"sourceKind":       extension,
							"priorDeclaration": p.host.FS().FileExists(tspath.RootedFilePathFromNormalized(moduleBodyDeclarationPath(body))),
						})
					}
					return true
				}
			}
		}
	}
	return false
}
