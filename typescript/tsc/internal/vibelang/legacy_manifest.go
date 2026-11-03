package vibelang

import (
	"encoding/json"
	"slices"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

// Historical migration provenance only. Current call contracts never consult
// obsolete manifests, and builds neither emit them nor include them as inputs.
// Legacy --fix must still reproduce the old failure/defect split.
type legacyManifestRecord struct {
	Declarations []string `json:"declarations"`
}

// legacyManifestsKey keys the checker's cache of the manifests it read.
type legacyManifestsKey struct{}

// legacyListedInManifest reports whether file, a declaration file, is listed in
// the nearest vibelang.manifest.json above it, up to its package's root.
func legacyListedInManifest(c *checker.Checker, file *ast.SourceFile) bool {
	if file == nil || !file.IsDeclarationFile {
		return false
	}
	program, ok := c.Program().(interface{ Host() compiler.CompilerHost })
	if !ok {
		return false
	}
	cache := c.ExtensionState(legacyManifestsKey{}, func() any { return map[tspath.RootedFilePath]*legacyManifestRecord{} }).(map[tspath.RootedFilePath]*legacyManifestRecord)
	read := func(path tspath.RootedFilePath) *legacyManifestRecord {
		if m, ok := cache[path]; ok {
			return m
		}
		var m *legacyManifestRecord
		if text, ok := program.Host().FS().ReadFile(path); ok {
			m = &legacyManifestRecord{}
			if json.Unmarshal([]byte(text), m) != nil {
				m = nil
			}
		}
		cache[path] = m
		return m
	}
	root, _ := packageRootOf(c, file.FileName().Directory())
	for directory := file.FileName().Directory(); ; {
		if m := read(directory.ResolveFile("vibelang.manifest.json")); m != nil {
			relative := tspath.GetRelativePathFromDirectory(directory.AsString(), file.FileName().AsString(), c.Program().CaseSensitivity())
			return slices.Contains(m.Declarations, relative)
		}
		parent := directory.AsPath().Directory()
		if directory == root || parent == directory {
			return false
		}
		directory = parent
	}
}
