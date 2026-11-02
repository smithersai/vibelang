package tspath

import (
	"slices"
	"strings"
)

const (
	ExtensionTs          = ".ts"
	ExtensionTsx         = ".tsx"
	ExtensionDts         = ".d.ts"
	ExtensionJs          = ".js"
	ExtensionJsx         = ".jsx"
	ExtensionJson        = ".json"
	ExtensionTsBuildInfo = ".tsbuildinfo"
	ExtensionMjs         = ".mjs"
	ExtensionMts         = ".mts"
	ExtensionDmts        = ".d.mts"
	ExtensionCjs         = ".cjs"
	ExtensionCts         = ".cts"
	ExtensionDcts        = ".d.cts"
	ExtensionVibe        = ".vibe"  // VibeLang source; parses as TypeScript
	ExtensionVibex       = ".vibex" // VibeLang source with JSX; parses as TSX (VIP-39)
)

var (
	SupportedDeclarationExtensions                 = []string{ExtensionDts, ExtensionDcts, ExtensionDmts}
	SupportedTSImplementationExtensions            = []string{ExtensionTs, ExtensionTsx, ExtensionMts, ExtensionCts, ExtensionVibe, ExtensionVibex}
	supportedTSExtensionsForExtractExtension       = []string{ExtensionDts, ExtensionDcts, ExtensionDmts, ExtensionTs, ExtensionTsx, ExtensionMts, ExtensionCts, ExtensionVibe, ExtensionVibex}
	AllSupportedExtensions                         = [][]string{{ExtensionTs, ExtensionTsx, ExtensionDts, ExtensionJs, ExtensionJsx, ExtensionVibe, ExtensionVibex}, {ExtensionCts, ExtensionDcts, ExtensionCjs}, {ExtensionMts, ExtensionDmts, ExtensionMjs}}
	SupportedTSExtensions                          = [][]string{{ExtensionTs, ExtensionTsx, ExtensionDts, ExtensionVibe, ExtensionVibex}, {ExtensionCts, ExtensionDcts}, {ExtensionMts, ExtensionDmts}}
	SupportedTSExtensionsFlat                      = []string{ExtensionTs, ExtensionTsx, ExtensionDts, ExtensionCts, ExtensionDcts, ExtensionMts, ExtensionDmts, ExtensionVibe, ExtensionVibex}
	SupportedJSExtensions                          = [][]string{{ExtensionJs, ExtensionJsx}, {ExtensionMjs}, {ExtensionCjs}}
	SupportedJSExtensionsFlat                      = []string{ExtensionJs, ExtensionJsx, ExtensionMjs, ExtensionCjs}
	AllSupportedExtensionsWithJson                 = slices.Concat(AllSupportedExtensions, [][]string{{ExtensionJson}})
	SupportedTSExtensionsWithJson                  = slices.Concat(SupportedTSExtensions, [][]string{{ExtensionJson}})
	SupportedTSExtensionsWithJsonFlat              = slices.Concat(SupportedTSExtensionsFlat, []string{ExtensionJson})
	ExtensionsNotSupportingExtensionlessResolution = []string{ExtensionMts, ExtensionDmts, ExtensionMjs, ExtensionCts, ExtensionDcts, ExtensionCjs}
)

// IsVibeLangSource reports whether fileName names a VibeLang source, a .vibe
// or a .vibex file (VIP-39). A declaration sidecar such as x.d.vibe.ts is
// TypeScript. Every "is this VibeLang?" test calls it.
func IsVibeLangSource(fileName string) bool {
	return VibeLangSourceExtension(fileName) != ""
}

// VibeLangSourceExtension returns the extension of a VibeLang source,
// ".vibe" or ".vibex", or "" when fileName is not one. A site that strips the
// extension to build a name strips this one.
func VibeLangSourceExtension(fileName string) string {
	switch {
	case strings.HasSuffix(fileName, ExtensionVibe):
		return ExtensionVibe
	case strings.HasSuffix(fileName, ExtensionVibex):
		return ExtensionVibex
	}
	return ""
}

// IsVibeLangSource reports whether f names a .vibe or .vibex source.
func (f RootedFilePath) IsVibeLangSource() bool {
	return IsVibeLangSource(string(f))
}

func ExtensionIsTs(ext string) bool {
	return ext == ExtensionTs || ext == ExtensionTsx || ext == ExtensionDts || ext == ExtensionVibe || ext == ExtensionVibex || ext == ExtensionMts || ext == ExtensionDmts || ext == ExtensionCts || ext == ExtensionDcts || len(ext) >= 7 && ext[:3] == ".d." && ext[len(ext)-3:] == ".ts"
}

var extensionsToRemove = []string{ExtensionDts, ExtensionDmts, ExtensionDcts, ExtensionMjs, ExtensionMts, ExtensionCjs, ExtensionCts, ExtensionTs, ExtensionJs, ExtensionTsx, ExtensionJsx, ExtensionJson, ExtensionVibe, ExtensionVibex}

func RemoveFileExtension(path string) string {
	// Remove any known extension even if it has more than one dot
	for _, ext := range extensionsToRemove {
		if strings.HasSuffix(path, ext) {
			return path[:len(path)-len(ext)]
		}
	}

	return path
}

func RemoveAnyFileExtension(path string) string {
	if withoutExtension := RemoveFileExtension(path); withoutExtension != path {
		return withoutExtension
	}
	if extension := GetAnyExtensionFromPath(path, nil, CaseSensitive); extension != "" {
		return RemoveExtension(path, extension)
	}
	return path
}

func TryGetExtensionFromPath(p string) string {
	for _, ext := range extensionsToRemove {
		if FileExtensionIs(p, ext) {
			return ext
		}
	}
	return ""
}

func RemoveExtension(path string, extension string) string {
	return path[:len(path)-len(extension)]
}

func FileExtensionIsOneOf(path string, extensions []string) bool {
	for _, ext := range extensions {
		if FileExtensionIs(path, ext) {
			return true
		}
	}
	return false
}

func TryExtractTSExtension(fileName string) string {
	for _, ext := range supportedTSExtensionsForExtractExtension {
		if FileExtensionIs(fileName, ext) {
			return ext
		}
	}
	return ""
}

func HasTSFileExtension(path string) bool {
	return FileExtensionIsOneOf(path, SupportedTSExtensionsFlat)
}

func HasImplementationTSFileExtension(path string) bool {
	return FileExtensionIsOneOf(path, SupportedTSImplementationExtensions) && !IsDeclarationFileName(path)
}

func HasJSFileExtension(path string) bool {
	return FileExtensionIsOneOf(path, SupportedJSExtensionsFlat)
}

func HasJSONFileExtension(path string) bool {
	return FileExtensionIs(path, ExtensionJson)
}

func IsDeclarationFileName(fileName string) bool {
	return GetDeclarationFileExtension(fileName) != ""
}

func ExtensionIsOneOf(ext string, extensions []string) bool {
	return slices.Contains(extensions, ext)
}

func GetDeclarationFileExtension(fileName string) string {
	return getDeclarationFileExtensionFromNormalized(NormalizeSlashes(fileName))
}

func getDeclarationFileExtensionFromNormalized(fileName string) string {
	base := getBaseFileNameFromNormalized(fileName)
	for _, ext := range SupportedDeclarationExtensions {
		if strings.HasSuffix(base, ext) {
			return ext
		}
	}
	if strings.HasSuffix(base, ExtensionTs) {
		index := strings.Index(base, ".d.")
		if index >= 0 {
			return base[index:]
		}
	}
	return ""
}

func GetDeclarationEmitExtensionForPath(path string) string {
	switch {
	case FileExtensionIsOneOf(path, []string{ExtensionMjs, ExtensionMts}):
		return ExtensionDmts
	case FileExtensionIsOneOf(path, []string{ExtensionCjs, ExtensionCts}):
		return ExtensionDcts
	case FileExtensionIsOneOf(path, []string{ExtensionTs, ExtensionTsx, ExtensionJs, ExtensionJsx, ExtensionVibe, ExtensionVibex}):
		return ExtensionDts
	default:
		ext := GetAnyExtensionFromPath(path, nil, CaseSensitive)
		if ext != "" {
			return ".d" + ext + ".ts"
		}
		return ExtensionDts
	}
}

// ChangeAnyExtension changes the extension of a path to the provided extension if it has one of the provided extensions.
//
// ChangeAnyExtension("/path/to/file.ext", ".js", ".ext") === "/path/to/file.js"
// ChangeAnyExtension("/path/to/file.ext", ".js", ".ts") === "/path/to/file.ext"
// ChangeAnyExtension("/path/to/file.ext", ".js", [".ext", ".ts"]) === "/path/to/file.js"
func ChangeAnyExtension(path string, ext string, extensions []string, caseSensitivity CaseSensitivity) string {
	pathext := GetAnyExtensionFromPath(path, extensions, caseSensitivity)
	if pathext != "" {
		result := path[:len(path)-len(pathext)]
		if ext == "" {
			return result
		}
		if strings.HasPrefix(ext, ".") {
			return result + ext
		}
		return result + "." + ext
	}
	return path
}

func ChangeExtension(path string, newExtension string) string {
	return ChangeAnyExtension(path, newExtension, extensionsToRemove, CaseSensitive)
}

// Like `changeAnyExtension`, but declaration file extensions are recognized
// and replaced starting from the `.d`.
//
//	changeAnyExtension("file.d.ts", ".js") === "file.d.js"
//	changeFullExtension("file.d.ts", ".js") === "file.js"
func ChangeFullExtension(path string, newExtension string) string {
	declarationExtension := GetDeclarationFileExtension(path)
	if declarationExtension != "" {
		ext := newExtension
		if ext == "" {
			return path[:len(path)-len(declarationExtension)]
		}
		if !strings.HasPrefix(ext, ".") {
			ext = "." + ext
		}
		return path[:len(path)-len(declarationExtension)] + ext
	}
	return ChangeExtension(path, newExtension)
}

func GetPossibleOriginalInputExtensionForExtension(path string) []string {
	if FileExtensionIsOneOf(path, []string{ExtensionDmts, ExtensionMjs, ExtensionMts}) {
		return []string{ExtensionMts, ExtensionMjs}
	}
	if FileExtensionIsOneOf(path, []string{ExtensionDcts, ExtensionCjs, ExtensionCts}) {
		return []string{ExtensionCts, ExtensionCjs}
	}
	// Handle any custom .d.x.ts extension (e.g., .d.json.ts -> .json, .d.css.ts -> .css)
	if ext := GetDeclarationFileExtension(path); ext != "" && ext != ExtensionDts {
		inner := ext[len(".d.") : len(ext)-len(".ts")]
		return []string{"." + inner}
	}
	return []string{ExtensionTsx, ExtensionTs, ExtensionJsx, ExtensionJs}
}
