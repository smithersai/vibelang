package vibelangfuzz

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/module"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/vfstest"
	"strings"
	"testing"
)

const vibexResolutionQuote = "Resolution treats `.vibex` as `.vibe`'s `.tsx`:"
const vibexSourceSubstitutionQuote = "`./App.vibex` tries `App.vibex`, `App.vibe`, then `App.d.ts`"

func TestVibexResolutionQuoted(t *testing.T) {
	text := SpecText("../vips/0039-vibex.md")
	for _, quote := range []string{vibexResolutionQuote, vibexSourceSubstitutionQuote} {
		if !strings.Contains(text, quote) {
			t.Fatalf("VIP-39 no longer says %q", quote)
		}
	}
}

type vibexResolutionHost struct{ fs vfs.FS }

func (h vibexResolutionHost) FS() vfs.FS                                      { return h.fs }
func (h vibexResolutionHost) GetCurrentDirectory() tspath.RootedDirectoryPath { return "/repo" }

// The oracle is the VIP-39 resolution table, not a compiler-generated result.
// Keyed rules vary basenames, configured suffixes, native competitors and
// paired declarations without erasing written source identity.
func FuzzVibexResolution(f *testing.F) {
	startShortBudget(f)
	keys := []string{"runtime-js", "runtime-jsx", "explicit-vibe", "explicit-vibex", "paired-sidecar"}
	for _, key := range keys {
		for _, n := range []uint8{0, 1, 2, 3, 4, 7, 8, 12, 15} {
			f.Add(key, n)
		}
	}
	f.Fuzz(func(t *testing.T, key string, n uint8) {
		TestVibexResolutionQuoted(t)
		known := false
		for _, k := range keys {
			if key == k {
				known = true
			}
		}
		if !known {
			if key == "" {
				return
			}
			key = keys[int(key[0])%len(keys)]
		}
		stem := fmt.Sprintf("Panel%d", n%7)
		suffix := ""
		suffixes := []string(nil)
		if n&1 != 0 {
			suffix = ".web"
			suffixes = []string{".web", ""}
		}
		written := ".js"
		target := ".vibex"
		files := map[string]string{"/repo/main.ts": ""}
		switch key {
		case "runtime-js":
			if n&2 != 0 {
				target = ".vibe"
				files["/repo/"+stem+suffix+".vibe"] = ""
			}
			if n&4 != 0 {
				target = ".tsx"
				files["/repo/"+stem+suffix+".tsx"] = ""
			}
			if n&8 != 0 {
				target = ".ts"
				files["/repo/"+stem+suffix+".ts"] = ""
			}
		case "runtime-jsx":
			written = ".jsx"
			if n&2 != 0 {
				files["/repo/"+stem+suffix+".vibe"] = ""
			}
			if n&4 != 0 {
				target = ".ts"
				files["/repo/"+stem+suffix+".ts"] = ""
			}
			if n&8 != 0 {
				target = ".tsx"
				files["/repo/"+stem+suffix+".tsx"] = ""
			}
		case "explicit-vibe":
			written = ".vibe"
			if n&2 != 0 {
				target = ".vibe"
				files["/repo/"+stem+suffix+".vibe"] = ""
			}
			files["/repo/"+stem+suffix+".ts"] = ""
		case "explicit-vibex":
			written = ".vibex"
			if n&2 != 0 {
				target = ".vibe"
			} // only the alternate source remains
			files["/repo/"+stem+suffix+".tsx"] = ""
		case "paired-sidecar":
			// Put any platform suffix in the written basename. Both the source
			// and its sidecar are reachable without a configured suffix trick.
			written = suffix + ".vibex"
			suffixes = nil
			files["/repo/"+stem+suffix+".d.vibex.ts"] = ""
		}
		// Every rule except the alternate-only source has a JSX source available.
		if key != "explicit-vibex" || n&2 == 0 {
			files["/repo/"+stem+suffix+".vibex"] = ""
		}
		files["/repo/"+stem+suffix+target] = ""
		fs := vfstest.FromMap(files, tspath.CaseSensitive)
		opts := &core.CompilerOptions{ModuleResolution: core.ModuleResolutionKindBundler, Module: core.ModuleKindESNext, Jsx: core.JsxEmitReact, ModuleSuffixes: suffixes}
		resolver := module.NewResolver(module.ResolverOptions{Host: vibexResolutionHost{fs}, CompilerOptions: opts})
		got, _, err := resolver.ResolveModuleName("./"+stem+written, "/repo/main.ts", core.ModuleKindESNext, nil)
		if err != nil {
			t.Fatal(err)
		}
		want := "/repo/" + stem + suffix + target
		if string(got.ResolvedFileName) != want {
			Gap(t, "FuzzVibexResolution", key, "VIP-39: %s resolved to %s, want %s (variation %d)", written, got.ResolvedFileName, want, n)
		}
		if key == "paired-sidecar" {
			delete(files, want)
			resolver = module.NewResolver(module.ResolverOptions{
				Host: vibexResolutionHost{vfstest.FromMap(files, tspath.CaseSensitive)}, CompilerOptions: opts,
			})
			sidecar, _, err := resolver.ResolveModuleName("./"+stem+written, "/repo/main.ts", core.ModuleKindESNext, nil)
			if err != nil {
				t.Fatal(err)
			}
			wantSidecar := "/repo/" + stem + suffix + ".d.vibex.ts"
			if string(sidecar.ResolvedFileName) != wantSidecar {
				Gap(t, "FuzzVibexResolution", key, "VIP-39: without live source, resolved %s, want reachable sidecar %s", sidecar.ResolvedFileName, wantSidecar)
			}
		}
	})
}
