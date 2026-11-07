package vibelangfuzz

import (
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const platformHTTPAdviceTarget = "FuzzPlatformHTTPAdvice"
const platformHTTPColdQuote = "Returning an Effect does not itself execute it."
const platformHTTPDiagnosticQuote = "Every VibeLang diagnostic says what is wrong and how to fix it, with a mechanical quick fix where possible."

func TestPlatformHTTPAdviceQuoted(t *testing.T) {
	platformHTTPBoundaryQuoted(t)
	chapterSays(t, "002-running.md", platformHTTPColdQuote)
	chapterSays(t, "007-tooling.md", platformHTTPDiagnosticQuote)
}

type platformHTTPAdviceCase struct {
	Key, Source, Advice, Replacement string
	Want                             int
}

// Static advice must run the request Effect and remain valid with explicit imports.
func FuzzPlatformHTTPAdvice(f *testing.F) {
	startShortBudget(f)
	chapterSays(f, "002-running.md", platformHTTPColdQuote)
	chapterSays(f, "007-tooling.md", platformHTTPDiagnosticQuote)
	platformHTTPBoundaryQuoted(f)
	data, err := os.ReadFile(filepath.Join(Root(), "typescript/tsc/internal/vibelangfuzz/testdata/platform-http-advice.json"))
	if err != nil {
		f.Fatal(err)
	}
	var cases []platformHTTPAdviceCase
	if err := json.Unmarshal(data, &cases); err != nil {
		f.Fatal(err)
	}
	for _, test := range cases {
		f.Add([]byte(test.Key + "\x00\x00"))
		f.Add([]byte(test.Key + "\x00\x01"))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		parts := strings.SplitN(string(data), "\x00", 2)
		index := slices.IndexFunc(cases, func(c platformHTTPAdviceCase) bool { return c.Key == parts[0] })
		if index < 0 {
			index = len(data) % len(cases)
		}
		test := cases[index]
		mode := byte(0)
		if len(parts) == 2 && len(parts[1]) != 0 {
			mode = parts[1][0]
		}
		file := "main.vibe"
		if mode&4 != 0 {
			file = "main.vibex"
		}
		source := test.Source
		if mode&2 != 0 {
			source = "// retained \u00e9\r\n" + strings.ReplaceAll(source, "\n", "\r\n")
		}
		config := map[string]any{
			"compilerOptions": map[string]any{"strict": true, "noEmit": true, "target": "ES2022", "module": "NodeNext", "skipLibCheck": true, "jsx": "preserve", "types": []string{}},
			"files":           []string{file, "node_modules/@types/node/index.d.ts"},
		}
		if mode&1 != 0 {
			config["vibe"] = map[string]any{"effectGlobals": false, "effectModules": false}
		}
		encoded, err := json.Marshal(config)
		if err != nil {
			t.Fatal(err)
		}
		files := map[string]string{
			file:                                    source,
			"package.json":                          servicesPackage,
			"node_modules/@types/node/package.json": "{\"name\":\"@types/node\",\"types\":\"index.d.ts\"}",
			"node_modules/@types/node/index.d.ts":   "declare var process: { stdout: unknown; stderr: unknown };\ndeclare module \"node:console\" { export function log(...values: unknown[]): void; export function warn(...values: unknown[]): void }\n",
		}
		result, err := w.Compile(t.Context(), Project{Config: string(encoded), Files: files})
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		count := 0
		for _, d := range result.Diagnostics {
			if d.Source() == "EK" && d.Code() == 4402 {
				count++
				if text := layerMergeAdviceText(d); !strings.Contains(text, test.Advice) {
					Gap(t, platformHTTPAdviceTarget, test.Key, "%s %s; want %q in %s", platformHTTPColdQuote, platformHTTPDiagnosticQuote, test.Advice, text)
					return
				}
			} else if d.Category() == diagnostics.CategoryError {
				t.Fatalf("fixture %s rejected: %s", test.Key, d.String())
			}
		}
		if count != test.Want {
			Gap(t, platformHTTPAdviceTarget, test.Key, "want %d EK4402, got %d", test.Want, count)
			return
		}
		if test.Want != 0 {
			files[file] = test.Replacement
			checked, err := w.Compile(t.Context(), Project{Config: string(encoded), Files: files})
			if err != nil {
				t.Fatal(err)
			}
			defer checked.Remove()
			for _, d := range checked.Diagnostics {
				if d.Category() == diagnostics.CategoryError {
					Gap(t, platformHTTPAdviceTarget, test.Key+":advice", "replacement rejected: %s", d.String())
					return
				}
			}
		}
		ExpectPending(t, platformHTTPAdviceTarget, test.Key)
		ExpectPending(t, platformHTTPAdviceTarget, specCorpusKey(t))
	})
}

func platformHTTPBoundaryQuoted(t testing.TB) {
	t.Helper()
	chapterSays(t, "005-services.md", "`EK4402` asks one question of a statically named value: does the symbol it resolves to reach the platform, by doing I/O, starting a timer, or reading or changing host state?")
	chapterSays(t, "005-services.md", "Only value positions are `EK4402`: a type query such as `type Timer = ReturnType<typeof setTimeout>` is erased and allowed, as `import type` is.")
	chapterSays(t, "005-services.md", "A local binding, an import or an Effect module in scope (`Option`, `FileSystem`, `Headers`, `Worker`) shadows the global first, and a project's own `declare var fetch` is not a host declaration.")
}
