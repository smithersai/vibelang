package compiler

import (
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/module"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
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
