package vibelangfuzz

import (
	"encoding/json"
	"fmt"
	"maps"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

const platformTypeExportFixTarget = "FuzzPlatformTypeExportFix"
const platformTypeExportFixQuote = "if the move cannot preserve run phase, captures, receiver and public types"
const platformTypeExportFixedPointQuote = "One `vibelang --fix` run applies fixes until none applies; running it again changes nothing."

type platformTypeExportFixCase struct {
	Key, Source, Module string
	TypeOnly            bool
}

func TestPlatformTypeExportFixQuoted(t *testing.T) {
	chapterSays(t, "005-services.md", platformTypeExportFixQuote)
	chapterSays(t, "007-tooling.md", platformTypeExportFixedPointQuote)
}

func FuzzPlatformTypeExportFix(f *testing.F) {
	startShortBudget(f)
	chapterSays(f, "005-services.md", platformTypeExportFixQuote)
	chapterSays(f, "007-tooling.md", platformTypeExportFixedPointQuote)
	data, err := os.ReadFile(filepath.Join(Root(), "typescript/tsc/internal/vibelangfuzz/testdata/platform-type-export-fixes.json"))
	if err != nil {
		f.Fatal(err)
	}
	var cases []platformTypeExportFixCase
	if err := json.Unmarshal(data, &cases); err != nil {
		f.Fatal(err)
	}
	for _, test := range cases {
		f.Add(test.Key, byte(0))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, mode byte) {
		at := slices.IndexFunc(cases, func(c platformTypeExportFixCase) bool { return c.Key == key })
		if at < 0 {
			at = len(key) % len(cases)
		}
		test := cases[at]
		source := strings.Repeat("// preserve export comment\n", int(mode%3)) + test.Source
		if mode&4 != 0 {
			source = "const café = \"😀\"; void café;\n" + source
		}
		if mode&8 != 0 {
			source = strings.ReplaceAll(source, "\n", "\r\n")
		}
		file := "main.vibe"
		if mode&16 != 0 {
			file = "main.vibex"
		}
		config := fmt.Sprintf(`{"compilerOptions":{"strict":true,"target":"ES2022","module":"NodeNext","skipLibCheck":true,"noEmit":true,"jsx":"preserve","types":[],"verbatimModuleSyntax":true},"files":[%q,"node.d.ts"]}`, file)
		files := map[string]string{file: source, "package.json": servicesPackage, "node.d.ts": platformTypeExportModules}
		before, err := w.Compile(t.Context(), Project{Config: config, Files: files})
		if err != nil {
			t.Fatal(err)
		}
		defer before.Remove()
		count := 0
		for _, d := range before.Diagnostics {
			if d.Category() != diagnostics.CategoryError {
				continue
			}
			if !IsEK(d) || d.Code() != 4402 {
				Gap(t, platformTypeExportFixTarget, test.Key, "invalid source: %s", d.String())
				return
			}
			count++
		}
		if count == 0 {
			Gap(t, platformTypeExportFixTarget, test.Key, "missing preserved runtime load diagnostic")
			return
		}
		result := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, before.Dir), vibelang.FixOptions{})
		if result.Err != nil || len(result.Refused) != 0 || len(result.Files) != 1 {
			Gap(t, platformTypeExportFixTarget, test.Key, "expected a preserving source-only repair: %+v", result)
			return
		}
		fixed := maps.Clone(files)
		for name, edited := range result.Files {
			relative := strings.TrimPrefix(name.AsString(), filepath.ToSlash(before.Dir)+"/")
			if relative != file {
				Gap(t, platformTypeExportFixTarget, test.Key, "unexpected repair target: %s", relative)
				return
			}
			fixed[file] = edited.Text
		}
		output := fixed[file]
		if strings.Count(output, "module $platformExport") != count || strings.Count(output, "import $platformExport") != count || !strings.Contains(output, "export {} from \""+test.Module+"\"") {
			Gap(t, platformTypeExportFixTarget, test.Key, "native dependency must still load once at each original export position: %s", output)
			return
		}
		if test.TypeOnly && !strings.Contains(output, "export type") {
			Gap(t, platformTypeExportFixTarget, test.Key, "lost public type export: %s", output)
			return
		}
		after, err := w.Compile(t.Context(), Project{Config: config, Files: fixed})
		if err != nil {
			t.Fatal(err)
		}
		defer after.Remove()
		if !toolsErrorFree(after) {
			Gap(t, platformTypeExportFixTarget, test.Key, "fixed source: %v", after.Diagnostics)
			return
		}
		again := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, after.Dir), vibelang.FixOptions{})
		if again.Err != nil || len(again.Files) != 0 || len(again.Refused) != 0 {
			Gap(t, platformTypeExportFixTarget, test.Key, "not a fixed point: %+v", again)
			return
		}
		ExpectPending(t, platformTypeExportFixTarget, test.Key)
		ExpectPending(t, platformTypeExportFixTarget, specCorpusKey(t))
	})
}
