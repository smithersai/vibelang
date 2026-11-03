package modulespecifiers

import (
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/debug"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

// Program errors validate that `noEmit` or `emitDeclarationOnly` is also set,
// so this function doesn't check them to avoid propagating errors.
func shouldAllowImportingTsExtension(compilerOptions *core.CompilerOptions, fromFileName tspath.RootedFilePath) bool {
	return compilerOptions.GetAllowImportingTsExtensions() || fromFileName.IsDeclarationFile()
}

func usesExtensionsOnImports(file SourceFileForSpecifierGeneration) bool {
	for _, ref := range file.Imports() {
		text := ref.Text()
		if tspath.PathIsRelative(text) && !tspath.FileExtensionIsOneOf(text, tspath.ExtensionsNotSupportingExtensionlessResolution) {
			// Preserve TypeScript's first-relative-import rule: a custom suffix
			// is not a native TS/JS ending.
			return !tspath.IsVibeLangSource(text) && (tspath.HasTSFileExtension(text) || tspath.HasJSFileExtension(text))
		}
	}
	return false
}

func inferPreference(
	resolutionMode core.ResolutionMode,
	sourceFile SourceFileForSpecifierGeneration,
	moduleResolutionIsNodeNext bool,
) ModuleSpecifierEnding {
	usesJsExtensions := false
	var specifiers []*ast.LiteralLikeNode
	if sourceFile != nil && len(sourceFile.Imports()) > 0 {
		specifiers = sourceFile.Imports()
	} else if sourceFile != nil && sourceFile.IsJS() {
		// !!! TODO: JS support
		// specifiers = core.Map(getRequiresAtTopOfFile(sourceFile), func(d *ast.Node) *ast.Node { return d.arguments[0] })
	}

	for _, specifier := range specifiers {
		path := specifier.Text()
		if tspath.PathIsRelative(path) {
			// !!! TODO: proper resolutionMode support
			if moduleResolutionIsNodeNext && resolutionMode == core.ResolutionModeCommonJS /* && getModeForUsageLocation(sourceFile!, specifier, compilerOptions) === ModuleKind.ESNext */ {
				// We're trying to decide a preference for a CommonJS module specifier, but looking at an ESM import.
				continue
			}
			if tspath.IsVibeLangSource(path) || tspath.FileExtensionIsOneOf(path, tspath.ExtensionsNotSupportingExtensionlessResolution) {
				// Required source suffixes, including .vibe/.vibex, do not
				// indicate a native .ts/.js ending preference (VIP-27).
				continue
			}
			if tspath.HasTSFileExtension(path) {
				return ModuleSpecifierEndingTsExtension
			}
			if tspath.HasJSFileExtension(path) {
				usesJsExtensions = true
			}
		}
	}

	if usesJsExtensions {
		return ModuleSpecifierEndingJsExtension
	}
	return ModuleSpecifierEndingMinimal
}

func getModuleSpecifierEndingPreference(
	pref ImportModuleSpecifierEndingPreference,
	resolutionMode core.ResolutionMode,
	compilerOptions *core.CompilerOptions,
	sourceFile SourceFileForSpecifierGeneration,
) ModuleSpecifierEnding {
	moduleResolution := compilerOptions.GetModuleResolutionKind()
	moduleResolutionIsNodeNext := core.ModuleResolutionKindNode16 <= moduleResolution && moduleResolution <= core.ModuleResolutionKindNodeNext

	if pref == ImportModuleSpecifierEndingPreferenceJs || resolutionMode == core.ResolutionModeESM && moduleResolutionIsNodeNext {
		// Extensions are explicitly requested or required. Now choose between .js and .ts.
		if !shouldAllowImportingTsExtension(compilerOptions, "") {
			return ModuleSpecifierEndingJsExtension
		}
		// `allowImportingTsExtensions` is a strong signal, so use .ts unless the file
		// already uses .js extensions and no .ts extensions.
		if inferPreference(resolutionMode, sourceFile, moduleResolutionIsNodeNext) != ModuleSpecifierEndingJsExtension {
			return ModuleSpecifierEndingTsExtension
		}
		return ModuleSpecifierEndingJsExtension
	}

	if pref == ImportModuleSpecifierEndingPreferenceMinimal {
		return ModuleSpecifierEndingMinimal
	}

	if pref == ImportModuleSpecifierEndingPreferenceIndex {
		return ModuleSpecifierEndingIndex
	}

	// No preference was specified.
	// Look at imports and/or requires to guess whether .js, .ts, or extensionless imports are preferred.
	// N.B. that `Index` detection is not supported since it would require file system probing to do
	// accurately, and more importantly, literally nobody wants `Index` and its existence is a mystery.
	if !shouldAllowImportingTsExtension(compilerOptions, "") {
		// If .ts imports are not valid, we only need to see one .js import to go with that.
		if sourceFile != nil && usesExtensionsOnImports(sourceFile) {
			return ModuleSpecifierEndingJsExtension
		}
		return ModuleSpecifierEndingMinimal
	}

	return inferPreference(resolutionMode, sourceFile, moduleResolutionIsNodeNext)
}

func getPreferredEnding(
	prefs UserPreferences,
	host ModuleSpecifierGenerationHost,
	compilerOptions *core.CompilerOptions,
	importingSourceFile SourceFileForSpecifierGeneration,
	oldImportSpecifier string,
	resolutionMode core.ResolutionMode,
) ModuleSpecifierEnding {
	if len(oldImportSpecifier) > 0 {
		if tspath.HasJSFileExtension(oldImportSpecifier) {
			return ModuleSpecifierEndingJsExtension
		}
		if strings.HasSuffix(oldImportSpecifier, "/index") {
			return ModuleSpecifierEndingIndex
		}
	}
	if resolutionMode == core.ResolutionModeNone {
		resolutionMode = host.GetDefaultResolutionModeForFile(importingSourceFile)
	}
	return getModuleSpecifierEndingPreference(
		prefs.ImportModuleSpecifierEnding,
		resolutionMode,
		compilerOptions,
		importingSourceFile,
	)
}

type ModuleSpecifierPreferences struct {
	relativePreference                RelativePreferenceKind
	getAllowedEndingsInPreferredOrder func(syntaxImpliedNodeFormat core.ResolutionMode) []ModuleSpecifierEnding
	excludeRegexes                    []string
}

func GetAllowedEndingsInPreferredOrder(
	prefs UserPreferences,
	host ModuleSpecifierGenerationHost,
	compilerOptions *core.CompilerOptions,
	importingSourceFile SourceFileForSpecifierGeneration,
	oldImportSpecifier string,
	syntaxImpliedNodeFormat core.ResolutionMode,
) []ModuleSpecifierEnding {
	preferredEnding := getPreferredEnding(
		prefs,
		host,
		compilerOptions,
		importingSourceFile,
		oldImportSpecifier,
		core.ResolutionModeNone,
	)
	resolutionMode := host.GetDefaultResolutionModeForFile(importingSourceFile)
	if resolutionMode != syntaxImpliedNodeFormat {
		preferredEnding = getPreferredEnding(
			prefs,
			host,
			compilerOptions,
			importingSourceFile,
			oldImportSpecifier,
			syntaxImpliedNodeFormat,
		)
	}
	moduleResolution := compilerOptions.GetModuleResolutionKind()
	moduleResolutionIsNodeNext := core.ModuleResolutionKindNode16 <= moduleResolution && moduleResolution <= core.ModuleResolutionKindNodeNext
	allowImportingTsExtension := shouldAllowImportingTsExtension(compilerOptions, importingSourceFile.FileName())
	// TypeScript uses `(syntaxImpliedNodeFormat ?? impliedNodeFormat)` here - fall back to the
	// file's default resolution mode when no syntax-implied mode is given.
	effectiveSyntaxMode := syntaxImpliedNodeFormat
	if effectiveSyntaxMode == core.ResolutionModeNone {
		effectiveSyntaxMode = resolutionMode
	}
	if effectiveSyntaxMode == core.ResolutionModeESM && moduleResolutionIsNodeNext {
		if allowImportingTsExtension {
			return []ModuleSpecifierEnding{ModuleSpecifierEndingTsExtension, ModuleSpecifierEndingJsExtension}
		}
		return []ModuleSpecifierEnding{ModuleSpecifierEndingJsExtension}
	}
	switch preferredEnding {
	case ModuleSpecifierEndingJsExtension:
		if allowImportingTsExtension {
			return []ModuleSpecifierEnding{ModuleSpecifierEndingJsExtension, ModuleSpecifierEndingTsExtension, ModuleSpecifierEndingMinimal, ModuleSpecifierEndingIndex}
		}
		return []ModuleSpecifierEnding{ModuleSpecifierEndingJsExtension, ModuleSpecifierEndingMinimal, ModuleSpecifierEndingIndex}
	case ModuleSpecifierEndingTsExtension:
		return []ModuleSpecifierEnding{ModuleSpecifierEndingTsExtension, ModuleSpecifierEndingMinimal, ModuleSpecifierEndingJsExtension, ModuleSpecifierEndingIndex}
	case ModuleSpecifierEndingIndex:
		if allowImportingTsExtension {
			return []ModuleSpecifierEnding{ModuleSpecifierEndingIndex, ModuleSpecifierEndingMinimal, ModuleSpecifierEndingTsExtension, ModuleSpecifierEndingJsExtension}
		}
		return []ModuleSpecifierEnding{ModuleSpecifierEndingIndex, ModuleSpecifierEndingMinimal, ModuleSpecifierEndingJsExtension}
	case ModuleSpecifierEndingMinimal:
		if allowImportingTsExtension {
			return []ModuleSpecifierEnding{ModuleSpecifierEndingMinimal, ModuleSpecifierEndingIndex, ModuleSpecifierEndingTsExtension, ModuleSpecifierEndingJsExtension}
		}
		return []ModuleSpecifierEnding{ModuleSpecifierEndingMinimal, ModuleSpecifierEndingIndex, ModuleSpecifierEndingJsExtension}
	default:
		debug.AssertNever(preferredEnding)
	}
	return []ModuleSpecifierEnding{ModuleSpecifierEndingMinimal}
}

func getModuleSpecifierPreferences(
	prefs UserPreferences,
	host ModuleSpecifierGenerationHost,
	compilerOptions *core.CompilerOptions,
	importingSourceFile SourceFileForSpecifierGeneration,
	oldImportSpecifier string,
) ModuleSpecifierPreferences {
	excludes := prefs.AutoImportSpecifierExcludeRegexes
	relativePreference := RelativePreferenceShortest
	if len(oldImportSpecifier) > 0 {
		if tspath.IsExternalModuleNameRelative(oldImportSpecifier) {
			relativePreference = RelativePreferenceRelative
		} else {
			relativePreference = RelativePreferenceNonRelative
		}
	} else {
		switch prefs.ImportModuleSpecifierPreference {
		case ImportModuleSpecifierPreferenceRelative:
			relativePreference = RelativePreferenceRelative
		case ImportModuleSpecifierPreferenceNonRelative:
			relativePreference = RelativePreferenceNonRelative
		case ImportModuleSpecifierPreferenceProjectRelative:
			relativePreference = RelativePreferenceExternalNonRelative
			// all others are shortest
		}
	}

	getAllowedEndingsInPreferredOrder := func(syntaxImpliedNodeFormat core.ResolutionMode) []ModuleSpecifierEnding {
		return GetAllowedEndingsInPreferredOrder(
			prefs,
			host,
			compilerOptions,
			importingSourceFile,
			oldImportSpecifier,
			syntaxImpliedNodeFormat,
		)
	}

	return ModuleSpecifierPreferences{
		excludeRegexes:                    excludes,
		relativePreference:                relativePreference,
		getAllowedEndingsInPreferredOrder: getAllowedEndingsInPreferredOrder,
	}
}

// TwinAllowedEndings returns the endings GetAllowedEndingsInPreferredOrder
// allows, in preferred order, for importingSourceFile's TypeScript twin: the
// file as its package wrote it before migration, which spells each relative
// import the file writes as ./x.vibe as twinSpecifier returns it (D298). A
// declaration names a VibeLang module the generator reached on its own by the
// first of these, as stock tsc names the twin's module.
func TwinAllowedEndings(prefs UserPreferences, host ModuleSpecifierGenerationHost, compilerOptions *core.CompilerOptions, importingSourceFile SourceFileForSpecifierGeneration, twinSpecifier func(string) string) []ModuleSpecifierEnding {
	return GetAllowedEndingsInPreferredOrder(prefs, host, compilerOptions, twinSourceFile{importingSourceFile, twinSpecifier}, "", core.ResolutionModeNone)
}

// twinSourceFile is a source file whose relative ./x.vibe imports read as
// twinSpecifier spells them.
type twinSourceFile struct {
	SourceFileForSpecifierGeneration
	twinSpecifier func(string) string
}

func (f twinSourceFile) Imports() []*ast.StringLiteralLike {
	imports := f.SourceFileForSpecifierGeneration.Imports()
	var factory *ast.NodeFactory
	result := make([]*ast.StringLiteralLike, len(imports))
	for i, specifier := range imports {
		result[i] = specifier
		if text := specifier.Text(); tspath.PathIsRelative(text) && tspath.FileExtensionIs(text, tspath.ExtensionVibe) {
			if factory == nil {
				factory = ast.NewNodeFactory(ast.NodeFactoryHooks{})
			}
			result[i] = factory.NewStringLiteral(f.twinSpecifier(text), ast.TokenFlagsNone)
		}
	}
	return result
}
