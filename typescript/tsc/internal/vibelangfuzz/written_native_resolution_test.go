package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/module"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/vfstest"
)

const writtenNativeResolutionQuote = "A written `./x.ts` keeps native substitutions, including `x.tsx` and `x.d.ts`, but never falls back to VibeLang source; no native candidate means `TS2307`."

func TestWrittenNativeResolutionQuoted(t *testing.T) {
	if !strings.Contains(SpecText("007-tooling.md"), writtenNativeResolutionQuote) {
		t.Fatal("Chapter 7 no longer states the written native source resolution rule")
	}
}

// The keyed source-resolution oracle varies native competitors, suffixes,
// basenames and resolution modes while migrated homonyms always exist.
func FuzzWrittenNativeResolution(f *testing.F) {
	startShortBudget(f)
	for _, key := range []string{"foldkit-stale-ts", "native-ts", "native-tsx"} {
		for _, mask := range []uint8{0, 1, 2, 4, 7, 8, 12, 15, 24, 31} {
			f.Add(key, mask)
		}
	}
	f.Fuzz(func(t *testing.T, key string, mask uint8) {
		TestWrittenNativeResolutionQuoted(t)
		extension := ".ts"
		switch key {
		case "foldkit-stale-ts":
			mask &= 24
		case "native-ts":
		case "native-tsx":
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
		base := "/repo/" + stem + suffix
		files := map[string]string{"/repo/main.ts": "", base + ".vibe": "", base + ".vibex": ""}
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
		resolver := module.NewResolver(module.ResolverOptions{
			Host:            vibexResolutionHost{fs},
			CompilerOptions: &core.CompilerOptions{ModuleResolution: mode, ModuleSuffixes: suffixes},
		})
		got, _, err := resolver.ResolveModuleName("./"+stem+extension, "/repo/main.ts", core.ModuleKindESNext, nil)
		if err != nil {
			t.Fatal(err)
		}
		if string(got.ResolvedFileName) != want {
			Gap(t, "FuzzWrittenNativeResolution", key, "%s: resolved %q, want %q (variation %d)", writtenNativeResolutionQuote, got.ResolvedFileName, want, mask)
		}
	})
}
