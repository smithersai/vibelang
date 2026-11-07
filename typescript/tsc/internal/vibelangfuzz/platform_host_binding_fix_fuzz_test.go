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
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

const platformHostBindingFixTarget = "FuzzPlatformHostBindingFix"
const platformHostBindingFixQuote = "if the move cannot preserve run phase, captures, receiver and public types"
const platformHostBindingFixedPointQuote = "One `vibelang --fix` run applies fixes until none applies; running it again changes nothing."

type platformHostBindingFixCase struct{ Key, Source string }

func TestPlatformHostBindingFixQuoted(t *testing.T) {
	chapterSays(t, "005-services.md", platformHostBindingFixQuote)
	chapterSays(t, "007-tooling.md", platformHostBindingFixedPointQuote)
}

func FuzzPlatformHostBindingFix(f *testing.F) {
	startShortBudget(f)
	chapterSays(f, "005-services.md", platformHostBindingFixQuote)
	chapterSays(f, "007-tooling.md", platformHostBindingFixedPointQuote)
	data, err := os.ReadFile(filepath.Join(Root(), "typescript/tsc/internal/vibelangfuzz/testdata/platform-host-binding-fixes.json"))
	if err != nil {
		f.Fatal(err)
	}
	var cases []platformHostBindingFixCase
	if err := json.Unmarshal(data, &cases); err != nil {
		f.Fatal(err)
	}
	for _, test := range cases {
		f.Add(test.Key, byte(0))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, mode byte) {
		at := slices.IndexFunc(cases, func(c platformHostBindingFixCase) bool { return c.Key == key })
		if at < 0 {
			at = len(key) % len(cases)
		}
		test := cases[at]
		source := strings.Repeat("// host binding comment\n", int(mode%3)) + test.Source
		if mode&4 != 0 {
			source = "// café 😀\n" + source
		}
		if mode&8 != 0 {
			source = strings.ReplaceAll(source, "\n", "\r\n")
		}
		file := "main.vibe"
		if mode&16 != 0 {
			file = "main.vibex"
		}
		config := fmt.Sprintf(`{"compilerOptions":{"strict":true,"target":"ES2022","module":"NodeNext","skipLibCheck":true,"noEmit":true,"jsx":"preserve","types":[]},"files":[%q]}`, file)
		files := map[string]string{file: source, "package.json": servicesPackage}
		before, err := w.Compile(t.Context(), Project{Config: config, Files: files})
		if err != nil {
			t.Fatal(err)
		}
		defer before.Remove()
		fixed := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, before.Dir), vibelang.FixOptions{})
		if fixed.Err != nil || len(fixed.Files) != 1 || len(fixed.Refused) != 0 {
			Gap(t, platformHostBindingFixTarget, test.Key, "expected one preserving owned-source repair: %+v", fixed)
			return
		}
		afterFiles := maps.Clone(files)
		for name, edited := range fixed.Files {
			relative := strings.TrimPrefix(name.AsString(), filepath.ToSlash(before.Dir)+"/")
			if relative != file {
				Gap(t, platformHostBindingFixTarget, test.Key, "unexpected file edit: %s", relative)
				return
			}
			afterFiles[file] = edited.Text
		}
		if strings.Count(afterFiles[file], "module $platformBindings") != 1 || !strings.Contains(afterFiles[file], "import $platformBindings") {
			Gap(t, platformHostBindingFixTarget, test.Key, "missing eager native boundary: %s", afterFiles[file])
			return
		}
		after, err := w.Compile(t.Context(), Project{Config: config, Files: afterFiles})
		if err != nil {
			t.Fatal(err)
		}
		defer after.Remove()
		if !toolsErrorFree(after) {
			Gap(t, platformHostBindingFixTarget, test.Key, "fixed source: %v", after.Diagnostics)
			return
		}
		again := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, after.Dir), vibelang.FixOptions{})
		if again.Err != nil || len(again.Files) != 0 || len(again.Refused) != 0 {
			Gap(t, platformHostBindingFixTarget, test.Key, "not a fixed point: %+v", again)
			return
		}
		ExpectPending(t, platformHostBindingFixTarget, test.Key)
		ExpectPending(t, platformHostBindingFixTarget, specCorpusKey(t))
	})
}
