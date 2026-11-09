package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/ls/autoimport"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsutil"
	"github.com/microsoft/TypeScript/tsc/internal/sourcemap"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

// programEditorHost serves in-memory programs for editor integration tests.
type programEditorHost struct {
	program    *compiler.Program
	converters *lsconv.Converters
}

func (h programEditorHost) CaseSensitivity() tspath.CaseSensitivity { return tspath.CaseSensitive }
func (h programEditorHost) ReadFile(path tspath.RootedFilePath) (string, bool) {
	if file := h.program.GetSourceFile(path); file != nil {
		return file.Text(), true
	}
	return "", false
}
func (h programEditorHost) Converters() *lsconv.Converters { return h.converters }
func (h programEditorHost) GetPreferences(string) lsutil.UserPreferences {
	return lsutil.UserPreferences{}
}
func (h programEditorHost) GetECMALineInfo(tspath.RootedFilePath) *sourcemap.ECMALineInfo { return nil }
func (h programEditorHost) AutoImportRegistry() *autoimport.Registry                      { return nil }
func (h programEditorHost) ReadDirectory(tspath.RootedDirectoryPath, []string, []string, []string, int) []tspath.RootedFilePath {
	return nil
}
func (h programEditorHost) GetDirectories(tspath.RootedDirectoryPath) []string { return nil }
func (h programEditorHost) DirectoryExists(tspath.RootedDirectoryPath) bool    { return false }
func (h programEditorHost) FileExists(tspath.RootedFilePath) bool              { return false }
