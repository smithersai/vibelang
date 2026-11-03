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

const vibexRootPriorityQuote = "`.vibe` and `.vibex` are supported source extensions: `files` may list them, and `include`, `exclude` and the default `**/*` treat `.vibe` as they treat `.ts` and `.vibex` as they treat `.tsx`"

func TestVibexRootPriorityQuoted(t *testing.T) {
	if !strings.Contains(SpecText("007-tooling.md"), vibexRootPriorityQuote) {
		t.Fatal("chapter 7 no longer states the TypeScript-twin discovery rule")
	}
}

// Static discovery oracle from chapter 7, with stock .ts/.tsx controls in the
// companion CLI fixture. Explicit inputs remain literal native inputs.
func FuzzVibexRootPriority(f *testing.F) {
	startShortBudget(f)
	keys := []string{"declaration", "javascript", "jsx-output"}
	for _, key := range keys {
		for _, n := range []uint8{0, 1, 2, 3, 7, 15, 16, 31, 32, 33, 34, 35, 48, 49, 50, 51} {
			f.Add(key, n)
		}
	}
	f.Fuzz(func(t *testing.T, key string, n uint8) {
		TestVibexRootPriorityQuoted(t)
		if !slices.Contains(keys, key) {
			if key == "" {
				return
			}
			key = keys[int(key[0])%len(keys)]
		}
		artifact := map[string]string{"declaration": ".d.ts", "javascript": ".js", "jsx-output": ".jsx"}[key]
		source := ".vibe"
		if n&1 != 0 {
			source = ".vibex"
		}
		stem := fmt.Sprintf("Panel%d", n%7)
		sourceName, artifactName := stem+source, stem+artifact
		explicit, allowJS := n&2 != 0, n&16 == 0
		jsx := "preserve"
		if n&8 != 0 {
			jsx = "react"
		}
		config := map[string]any{"compilerOptions": map[string]any{"jsx": jsx, "allowJs": allowJS}}
		want := []string{sourceName}
		if explicit {
			config["files"] = []string{artifactName, sourceName}
			want = append(want, artifactName)
		} else {
			config["include"] = []string{"**/*" + artifact, "**/*" + source}
		}
		if n&32 != 0 {
			if explicit {
				config["files"] = []string{artifactName}
				config["include"] = []string{"**/*" + source}
				want = []string{sourceName, artifactName}
			} else {
				config["files"] = []string{sourceName}
				config["include"] = []string{"**/*" + artifact}
				want = []string{sourceName}
			}
		}
		text, err := json.Marshal(config)
		if err != nil {
			t.Fatal(err)
		}
		cs := tspath.CaseSensitive
		if n&4 != 0 {
			cs = tspath.CaseInsensitive
		}
		fs := vfstest.FromMap(map[string]string{
			"/project/tsconfig.json":   string(text),
			"/project/" + sourceName:   "export const value=1;",
			"/project/" + artifactName: "export const stale: number;",
		}, cs)
		parsed, errors := tsoptions.GetParsedCommandLineOfConfigFile("/project/tsconfig.json", &core.CompilerOptions{}, nil, fs, nil)
		if len(errors) != 0 {
			t.Fatal(errors)
		}
		var got []string
		for _, name := range parsed.FileNames() {
			got = append(got, strings.TrimPrefix(name.AsString(), "/project/"))
		}
		slices.Sort(got)
		slices.Sort(want)
		if !slices.Equal(got, want) {
			Gap(t, "FuzzVibexRootPriority", fmt.Sprintf("%s:%s:files=%v:mixed=%v:allowJs=%v:jsx=%s:case=%v", key, source, explicit, n&32 != 0, allowJS, jsx, cs), "chapter 7 source discovery: roots=%v want=%v", got, want)
		}
	})
}
