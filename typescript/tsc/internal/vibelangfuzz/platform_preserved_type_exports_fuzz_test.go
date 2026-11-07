package vibelangfuzz

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const platformTypeExportTarget = "FuzzPlatformPreservedTypeExports"
const platformTypeExportQuote = "in a `.vibe` file, an `import` or `export … from` declaration, or an `import(…)` call with a string-literal specifier, whose specifier names a Node builtin with or without `node:` (`node:fs`, `fs`, `child_process`: Node's `module.builtinModules`), except an `import type` or `export type … from` declaration"
const platformTypeExportShadowQuote = "Only value positions are `EK4402`: a type query such as `type Timer = ReturnType<typeof setTimeout>` is erased and allowed, as `import type` is."

const platformTypeExportModules = `declare module "node:fs" {
  export interface Stats { size: number }
  export interface Dirent { name: string }
  export interface type { name: string }
  export function readFile(): void
}
declare module "fs" { export interface Stats { size: number } }
declare module "node:path" {}
declare module "ordinary" { export interface Stats { size: number } }
`

type platformTypeExportCase struct {
	Key, Source string
	Verbatim    bool
	Spans       []string
}

func TestPlatformPreservedTypeExportsQuoted(t *testing.T) {
	chapterSays(t, "005-services.md", platformTypeExportQuote)
	chapterSays(t, "005-services.md", platformTypeExportShadowQuote)
}

func FuzzPlatformPreservedTypeExports(f *testing.F) {
	startShortBudget(f)
	chapterSays(f, "005-services.md", platformTypeExportQuote)
	chapterSays(f, "005-services.md", platformTypeExportShadowQuote)
	data, err := os.ReadFile(filepath.Join(Root(), "typescript/tsc/internal/vibelangfuzz/testdata/platform-preserved-type-exports.json"))
	if err != nil {
		f.Fatal(err)
	}
	var cases []platformTypeExportCase
	if err := json.Unmarshal(data, &cases); err != nil {
		f.Fatal(err)
	}
	for _, test := range cases {
		f.Add(test.Key, byte(0))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, mode byte) {
		index := slices.IndexFunc(cases, func(c platformTypeExportCase) bool { return c.Key == key })
		if index < 0 {
			index = len(key) % len(cases)
		}
		test := cases[index]
		source := strings.Repeat("// host alias\n", int(mode%3)) + test.Source
		if mode&4 != 0 {
			source = "const unrelatedLocal = 1; void unrelatedLocal;\n" + source
		}
		if mode&8 != 0 {
			source = strings.ReplaceAll(source, "\n", "\r\n")
		}
		file := "main.vibe"
		if mode&16 != 0 {
			file = "main.vibex"
		}
		config := fmt.Sprintf(`{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"noEmit":true,"jsx":"preserve","types":[],"verbatimModuleSyntax":%t},"files":[%q,"node.d.ts"]}`, test.Verbatim, file)
		result, err := w.Compile(t.Context(), Project{Files: map[string]string{file: source, "package.json": servicesPackage, "node.d.ts": platformTypeExportModules}, Config: config})
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		var spans []string
		for _, d := range result.Diagnostics {
			if d.Category() != diagnostics.CategoryError {
				continue
			}
			if !IsEK(d) || d.Code() != 4402 {
				Gap(t, platformTypeExportTarget, test.Key, "unexpected diagnostic: %s", d.String())
				return
			}
			spans = append(spans, source[d.Pos():d.End()])
		}
		if !slices.Equal(spans, test.Spans) {
			Gap(t, platformTypeExportTarget, test.Key, "%s; mode=%d want spans %q got %q", platformTypeExportQuote, mode, test.Spans, spans)
			return
		}
		ExpectPending(t, platformTypeExportTarget, test.Key)
		ExpectPending(t, platformTypeExportTarget, specCorpusKey(t))
	})
}
