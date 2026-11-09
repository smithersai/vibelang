package vibelangfuzz

import (
	"encoding/json"
	"fmt"
	"os"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const globalThisImportAliasesTarget = "FuzzGlobalThisImportAliases"
const globalThisImportAliasesQuote = "`globalThis` may appear only as the object of a statically named member access; any other use,"

func TestGlobalThisImportAliasesQuoted(t *testing.T) {
	chapterSays(t, "005-services.md", globalThisImportAliasesQuote)
}

func FuzzGlobalThisImportAliases(f *testing.F) {
	startShortBudget(f)
	chapterSays(f, "005-services.md", globalThisImportAliasesQuote)
	data, err := os.ReadFile("testdata/globalthis-import-aliases.json")
	if err != nil {
		f.Fatal(err)
	}
	var cases []struct {
		Key, Source, NativeSource string
		Codes                     []string
	}
	if err = json.Unmarshal(data, &cases); err != nil {
		f.Fatal(err)
	}
	for _, row := range cases {
		for _, mode := range []byte{0, 3, 7} {
			f.Add(row.Key, mode)
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, mode byte) {
		at := slices.IndexFunc(cases, func(row struct {
			Key, Source, NativeSource string
			Codes                     []string
		}) bool {
			return row.Key == key
		})
		if at < 0 {
			at = len(key) % len(cases)
		}
		row := cases[at]
		extension := "vibe"
		if mode&4 != 0 {
			extension = "vibex"
		}
		for _, ext := range []string{"ts", extension} {
			source := row.Source
			if ext == "ts" && row.NativeSource != "" {
				source = row.NativeSource
			}
			if mode&1 != 0 {
				source = "// alias trivia\n" + strings.ReplaceAll(source, "held", "capturé") + "\n"
			}
			if mode&2 != 0 {
				source = strings.ReplaceAll(source, "\n", "\r\n")
			}
			file := "main." + ext
			config := fmt.Sprintf(`{"compilerOptions":{"target":"ES2022","module":"NodeNext","moduleResolution":"NodeNext","strict":true,"skipLibCheck":true,"types":[],"lib":["ES2022","DOM"],"jsx":"preserve","noEmit":true},"vibe":{"effectGlobals":false,"effectModules":false},"files":[%q]}`, file)
			result, err := w.Compile(t.Context(), Project{Files: map[string]string{file: source, "package.json": servicesPackage}, Config: config})
			if err != nil {
				t.Fatal(err)
			}
			defer result.Remove()
			var codes []string
			for _, d := range result.Diagnostics {
				if d.Category() != diagnostics.CategoryError {
					continue
				}
				prefix := d.Source()
				if prefix == "" {
					prefix = "TS"
				}
				codes = append(codes, fmt.Sprintf("%s%04d", prefix, d.Code()))
			}
			slices.Sort(codes)
			want := row.Codes
			if ext == "ts" {
				want = nil
			}
			if !slices.Equal(codes, want) {
				Gap(t, globalThisImportAliasesTarget, row.Key+":"+ext, "%s; want %v, got %v; source=%s", globalThisImportAliasesQuote, want, codes, source)
				return
			}
		}
		ExpectPending(t, globalThisImportAliasesTarget, row.Key)
		ExpectPending(t, globalThisImportAliasesTarget, specCorpusKey(t))
	})
}
