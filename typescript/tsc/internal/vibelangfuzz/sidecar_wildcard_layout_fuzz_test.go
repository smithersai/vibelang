package vibelangfuzz

import (
	"encoding/json"
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/vfstest"
)

const sidecarWildcardRootQuote = "an explicit `rootDir` supplies the source root, a composite project defaults to its config directory, and otherwise the root is the common source directory."

func sidecarWildcardLayoutQuoted(t testing.TB) {
	chapterSays(t, "007-tooling.md", sidecarWildcardRootQuote)
	chapterSays(t, "../vips/0027-declaration-output.md", "Discovery through `include` or default globs selects the source and omits its compatibility declaration, as native `.ts`/`.d.ts` discovery does.")
}
func TestSidecarWildcardLayoutQuoted(t *testing.T) { sidecarWildcardLayoutQuoted(t) }

func FuzzSidecarWildcardLayout(f *testing.F) {
	startShortBudget(f)
	sidecarWildcardLayoutQuoted(f)
	for mode := byte(0); mode < 64; mode++ {
		f.Add([]byte{mode})
	}
	f.Fuzz(func(t *testing.T, data []byte) {
		mode := byte(0)
		if len(data) > 0 {
			mode = data[0] & 63
		}
		ext := ".vibe"
		if mode&1 != 0 {
			ext = ".vibex"
		}
		relocated, explicit, present := mode&2 != 0, mode&4 != 0, mode&32 != 0
		rootMode := []string{"inferred", "config", "source", "composite"}[(mode>>3)&3]
		stem := "App"
		if len(data) > 1 && data[1]&1 != 0 {
			stem = "Widget"
		}
		source := "src/" + stem + ext
		paired := "src/" + stem + ".d" + ext + ".ts"
		options := map[string]any{"jsx": "preserve"}
		switch rootMode {
		case "config":
			options["rootDir"] = "."
		case "source":
			options["rootDir"] = "src"
		case "composite":
			options["composite"] = true
		}
		config := map[string]any{"compilerOptions": options}
		orphan := "published.d" + ext + ".ts"
		if relocated {
			paired = "types/" + paired
			if rootMode == "inferred" || rootMode == "source" {
				paired = "types/" + stem + ".d" + ext + ".ts"
			}
			config["vibe"] = map[string]any{"sidecarDir": "types"}
		}
		selected := []string{source, paired}
		if !present {
			selected = []string{paired}
		}
		if explicit {
			config["files"] = selected
		} else {
			config["include"] = []string{"**/*"}
		}
		configText, err := json.Marshal(config)
		if err != nil {
			t.Fatal(err)
		}
		files := map[string]string{
			"/case/tsconfig.json": string(configText),
			"/case/" + paired:     "export declare const value: number;",
			"/case/" + orphan:     "export declare const value: number;",
		}
		if present {
			files["/case/"+source] = "export const value=1;"
		}
		fs := vfstest.FromMap(files, tspath.CaseSensitive)
		parsed, errors := tsoptions.GetParsedCommandLineOfConfigFile("/case/tsconfig.json", &core.CompilerOptions{}, nil, fs, nil)
		key := fmt.Sprintf("%s/relocated=%v/root=%s/explicit=%v/present=%v", strings.TrimPrefix(ext, "."), relocated, rootMode, explicit, present)
		if len(errors) != 0 || len(parsed.Errors) != 0 {
			Gap(t, "FuzzSidecarWildcardLayout", key+":config", "valid fixture rejected: %v %v", errors, parsed.Errors)
			return
		}
		// A declaration without a source remains an input. Explicitly selected
		// declarations also remain inputs under every declaration-root mode.
		wantPaired := explicit || !present
		hasPaired := slices.Contains(parsed.FileNames(), tspath.RootedFilePath("/case/"+paired))
		if hasPaired != wantPaired {
			Gap(t, "FuzzSidecarWildcardLayout", key+":paired", "%s; roots=%v, paired=%s want=%v", sidecarWildcardRootQuote, parsed.FileNames(), paired, wantPaired)
		}
		if !explicit && !slices.Contains(parsed.FileNames(), tspath.RootedFilePath("/case/"+orphan)) {
			Gap(t, "FuzzSidecarWildcardLayout", key+":orphan", "unpaired published declaration lost: %v", parsed.FileNames())
		}
		ExpectPending(t, "FuzzSidecarWildcardLayout", key)
		ExpectPending(t, "FuzzSidecarWildcardLayout", specCorpusKey(t))
	})
}
