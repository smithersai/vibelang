package vibelangfuzz

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/collections"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/module"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/vfstest"
)

const writtenNativeAliasQuote = "Module resolution is as in TypeScript, with `.vibe` and `.vibex` beside `.ts` and `.tsx`:"

const writtenNativeResolutionQuote = "A written `./x.ts` keeps native substitutions, including `x.tsx` and `x.d.ts`, but never falls back to VibeLang source; no native candidate means `TS2307`."

func TestWrittenNativeResolutionQuoted(t *testing.T) {
	if !strings.Contains(SpecText("007-tooling.md"), writtenNativeResolutionQuote) || !strings.Contains(SpecText("007-tooling.md"), writtenNativeAliasQuote) {
		t.Fatal("Chapter 7 no longer states the written native source resolution rule")
	}
}

// The keyed source-resolution oracle varies native competitors, suffixes,
// basenames and resolution modes while migrated homonyms always exist.
func FuzzWrittenNativeResolution(f *testing.F) {
	startShortBudget(f)
	for _, key := range []string{"foldkit-stale-ts", "native-ts", "native-tsx", "alchemy-alias-ts", "alias-native-ts", "alias-native-tsx"} {
		for _, mask := range []uint8{0, 1, 2, 4, 7, 8, 12, 15, 24, 31} {
			f.Add(key, mask)
		}
		if strings.Contains(key, "alias") {
			f.Add(key, uint8(32))
			f.Add(key, uint8(63))
		}
	}
	f.Fuzz(func(t *testing.T, key string, mask uint8) {
		TestWrittenNativeResolutionQuoted(t)
		extension := ".ts"
		switch key {
		case "foldkit-stale-ts":
			mask &= 24
		case "alchemy-alias-ts":
			mask &= 56
		case "native-ts", "alias-native-ts":
		case "native-tsx", "alias-native-tsx":
			extension = ".tsx"
		default:
			return
		}
		stem := fmt.Sprintf("Target%d", mask%7)
		suffix := ""
		var suffixes []string
		if mask&8 != 0 {
			suffix, suffixes = ".web", []string{".web", ""}
		}
		alias := strings.Contains(key, "alias")
		directory, importer := "/repo/", "/repo/main.ts"
		if alias {
			directory = "/repo/src/"
			if mask&32 != 0 {
				directory += "nested/"
			}
		}
		var corpus struct{ File, Source, Importer, Quote string }
		if key == "alchemy-alias-ts" && mask == 0 {
			raw, err := os.ReadFile(filepath.Join(repoTestdata(), "corpus", "alchemy-bun-aliased-ts-specifier.json"))
			if err != nil {
				t.Fatal(err)
			}
			if err := json.Unmarshal(raw, &corpus); err != nil {
				t.Fatal(err)
			}
			if corpus.Quote != writtenNativeResolutionQuote || corpus.File != "src/entry.ts" || corpus.Source == "" || !strings.Contains(corpus.Importer, "\"@/entry.ts\"") {
				t.Fatal("invalid aliased source corpus")
			}
			stem = strings.TrimSuffix(filepath.Base(corpus.File), ".ts")
		}
		base := directory + stem + suffix
		files := map[string]string{importer: corpus.Importer, base + ".vibe": corpus.Source, base + ".vibex": corpus.Source}
		order := []string{".ts", ".tsx", ".d.ts"}
		if extension == ".tsx" {
			order[0], order[1] = order[1], order[0]
		}
		want := ""
		for i, candidate := range order {
			if mask&(1<<i) != 0 {
				files[base+candidate] = ""
				if want == "" {
					want = base + candidate
				}
			}
		}
		mode := core.ModuleResolutionKindBundler
		if mask&16 != 0 {
			mode = core.ModuleResolutionKindNodeNext
		}
		fs := vfstest.FromMap(files, tspath.CaseSensitive)
		options := &core.CompilerOptions{ModuleResolution: mode, ModuleSuffixes: suffixes}
		specifier := "./" + stem + extension
		if alias {
			options.Paths = collections.NewOrderedMapWithSizeHint[string, []string](1)
			options.Paths.Set("@/*", []string{"./src/*"})
			options.PathsBasePath = "/repo"
			specifier = "@/" + strings.TrimPrefix(directory, "/repo/src/") + stem + extension
		}
		resolver := module.NewResolver(module.ResolverOptions{
			Host: vibexResolutionHost{fs}, CompilerOptions: options,
		})
		got, _, err := resolver.ResolveModuleName(specifier, tspath.RootedFilePathFromAbsolute(importer), core.ModuleKindESNext, nil)
		if err != nil {
			t.Fatal(err)
		}
		if string(got.ResolvedFileName) != want {
			Gap(t, "FuzzWrittenNativeResolution", key, "%s: resolved %q, want %q (variation %d)", writtenNativeResolutionQuote, got.ResolvedFileName, want, mask)
		}
	})
}
