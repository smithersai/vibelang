package compiler

import (
	"encoding/json"
	"slices"

	"github.com/microsoft/TypeScript/tsc/internal/outputpaths"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

// VibeLangManifestName is the file a VibeLang build writes beside the
// declaration files it emits (D500). It lists each declaration file the
// build emitted from a .vibe file, relative to its own directory:
//
//	{ "declarations": ["index.d.ts", "util/text.d.ts"] }
//
// A declaration says what TypeScript can say: a plain function's TypeScript
// signature. What it cannot say, that the function was compiled from
// VibeLang and so never fails with an expected failure and needs no service,
// the manifest records outside it, so stock TypeScript reads declarations
// identical to the TypeScript original's. A consumer trusts each listed
// module as it trusts a package in trustedPackages.
const VibeLangManifestName = "vibelang.manifest.json"

// VibeLangManifest is the content of a VibeLangManifestName file.
type VibeLangManifest struct {
	Declarations []string `json:"declarations"`
}

// writeVibeLangManifest writes the manifest of the declaration files the
// program emits from .vibe files, in the declaration output root: the
// declarationDir, else the outDir, else the common source directory. It
// writes it when this emit wrote one of them, and lists every one, so an
// incremental emit of some files writes the whole manifest; it writes
// nothing for an emit of JavaScript or of declaration signatures only.
func (p *Program) writeVibeLangManifest(emitters []*emitter, emitOptions EmitOptions) {
	if emitOptions.EmitOnly == EmitOnlyBuilderSignature || emitOptions.EmitOnly == EmitOnlyJs {
		return
	}
	if !slices.ContainsFunc(emitters, func(e *emitter) bool { return e.vibeLangDeclaration != "" }) {
		return
	}
	var written []tspath.RootedFilePath
	for _, file := range p.getSourceFilesToEmit(nil, false, false) {
		if !isVibeLangSource(file.FileName()) {
			continue
		}
		if path := outputpaths.GetOutputPathsFor(file, p.Options(), p, outputpaths.ForceEmitPaths{}).DeclarationFilePath(); path != "" {
			written = append(written, path)
		}
	}
	writeFile := emitOptions.WriteFile
	options := p.Options()
	root := options.DeclarationDir
	if root == "" {
		root = options.OutDir
	}
	if root == "" {
		root = p.CommonSourceDirectory()
	}
	manifest := VibeLangManifest{}
	for _, file := range written {
		manifest.Declarations = append(manifest.Declarations, tspath.GetRelativePathFromDirectory(root.AsString(), file.AsString(), p.caseSensitivity))
	}
	slices.Sort(manifest.Declarations)
	text, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return
	}
	path := tspath.RootedFilePath(tspath.CombinePaths(root.AsString(), VibeLangManifestName))
	if writeFile != nil {
		_ = writeFile(path, string(text)+"\n", nil)
		return
	}
	_ = p.Host().FS().WriteFile(path, string(text)+"\n")
}

// isVibeLangSource reports whether fileName names a .vibe file.
func isVibeLangSource(fileName tspath.RootedFilePath) bool {
	return fileName.IsVibeLangSource()
}
