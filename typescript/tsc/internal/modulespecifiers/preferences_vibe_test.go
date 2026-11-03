package modulespecifiers

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

type spellingImports struct {
	SourceFileForSpecifierGeneration
	imports []*ast.StringLiteralLike
}

func (f spellingImports) Imports() []*ast.StringLiteralLike { return f.imports }

// Native TypeScript ending preferences do not include custom source suffixes.
// A required custom source suffix supplies no native .ts/.js preference.
func TestVibeImportsDoNotChooseNativeEndings(t *testing.T) {
	factory := ast.NewNodeFactory(ast.NodeFactoryHooks{})
	for _, custom := range []string{".vibe", ".vibex"} {
		for _, native := range []string{"", ".ts", ".tsx", ".js", ".jsx"} {
			for _, customFirst := range []bool{false, true} {
				refs := []*ast.StringLiteralLike{
					factory.NewStringLiteral("./bridge"+custom, ast.TokenFlagsNone),
					factory.NewStringLiteral("./banners"+native, ast.TokenFlagsNone),
				}
				if !customFirst {
					refs[0], refs[1] = refs[1], refs[0]
				}
				file := spellingImports{imports: refs}
				want := ModuleSpecifierEndingMinimal
				if native == ".ts" || native == ".tsx" {
					want = ModuleSpecifierEndingTsExtension
				}
				if native == ".js" || native == ".jsx" {
					want = ModuleSpecifierEndingJsExtension
				}
				if got := inferPreference(core.ResolutionModeNone, file, false); got != want {
					t.Errorf("%s native=%q customFirst=%t: got %v, want %v", custom, native, customFirst, got, want)
				}
				options := &core.CompilerOptions{ModuleResolution: core.ModuleResolutionKindBundler}
				wantWithoutTs := ModuleSpecifierEndingMinimal
				if native != "" && !customFirst {
					wantWithoutTs = ModuleSpecifierEndingJsExtension
				}
				if got := getModuleSpecifierEndingPreference(ImportModuleSpecifierEndingPreferenceNone, core.ResolutionModeNone, options, file); got != wantWithoutTs {
					t.Errorf("%s native=%q customFirst=%t: without TS extensions got %v, want %v", custom, native, customFirst, got, wantWithoutTs)
				}
				if got := usesExtensionsOnImports(file); got != (native != "" && !customFirst) {
					t.Errorf("%s native=%q customFirst=%t: usesExtensions=%t", custom, native, customFirst, got)
				}
			}
		}
	}
}

// Custom source modules need their suffix until the declaration emitter
// selects the native twin's output spelling.
func TestVibeSourceEndingsStayExplicit(t *testing.T) {
	for _, custom := range []string{".vibe", ".vibex"} {
		for _, ending := range []ModuleSpecifierEnding{ModuleSpecifierEndingMinimal, ModuleSpecifierEndingIndex, ModuleSpecifierEndingJsExtension, ModuleSpecifierEndingTsExtension} {
			written := "./bridge/index" + custom
			got := processEnding(tspath.ToModuleSpecifier(written), tspath.RootedFilePath("/project/bridge/index"+custom), []ModuleSpecifierEnding{ending}, &core.CompilerOptions{}, nil)
			if got.AsString() != written {
				t.Errorf("%s ending=%v: got %q, want %q", custom, ending, got, written)
			}
		}
	}
}
