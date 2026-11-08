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

const browserCountDiagnosticQuote = "Every VibeLang diagnostic says what is wrong and how to fix it, with a mechanical quick fix where possible."
const browserCountInjectionQuote = "Platform access is only through injected Effect services"
const browserCountExample = "read navigator.hardwareConcurrency in a .ts adapter"

func browserCountAdviceQuoted(t testing.TB) {
	t.Helper()
	chapterSays(t, "007-tooling.md", browserCountDiagnosticQuote)
	chapterSays(t, "005-services.md", browserCountInjectionQuote)
}
func TestBrowserCountAdviceQuoted(t *testing.T) { browserCountAdviceQuoted(t) }

func FuzzBrowserCountAdvice(f *testing.F) {
	startShortBudget(f)
	browserCountAdviceQuoted(f)
	var rows []struct {
		Key, Source string
		Host        bool
	}
	data, err := os.ReadFile(filepath.Join(Root(), "typescript/tsc/internal/vibelangfuzz/testdata/browser-count-advice.json"))
	if err != nil {
		f.Fatal(err)
	}
	if err = json.Unmarshal(data, &rows); err != nil {
		f.Fatal(err)
	}
	for _, row := range rows {
		for mode := byte(0); mode < 8; mode++ {
			f.Add([]byte(row.Key + "\x00" + string([]byte{mode})))
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		browserCountAdviceQuoted(t)
		parts := strings.SplitN(string(data), "\x00", 2)
		i := slices.IndexFunc(rows, func(row struct {
			Key, Source string
			Host        bool
		}) bool {
			return row.Key == parts[0]
		})
		if i < 0 {
			i = len(data) % len(rows)
		}
		mode := byte(0)
		if len(parts) > 1 && len(parts[1]) > 0 {
			mode = parts[1][0]
		}
		row := rows[i]
		source := row.Source
		if mode&1 != 0 {
			source = "// preserve the resolved host binding through trivia\n" + source
		}
		filename := "main.vibe"
		if mode&4 != 0 {
			filename = "main.vibex"
		}
		config := map[string]any{
			"compilerOptions": map[string]any{"strict": true, "target": "ES2022", "module": "NodeNext", "moduleResolution": "NodeNext", "types": []string{}, "skipLibCheck": true, "noEmit": true},
			"files":           []string{filename},
		}
		if mode&2 != 0 {
			config["vibe"] = map[string]bool{"effectGlobals": false, "effectModules": false}
		}
		encoded, err := json.Marshal(config)
		if err != nil {
			t.Fatal(err)
		}
		project := Project{Config: string(encoded), Files: map[string]string{filename: source, "package.json": `{"type":"module"}`}}
		r, err := w.Compile(t.Context(), project)
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		count := 0
		for _, d := range r.Diagnostics {
			if d.Source() != "EK" || d.Code() != 4402 {
				continue
			}
			count++
			text := layerMergeAdviceText(d)
			for _, want := range []string{browserCountExample, "not provided by the browser layer"} {
				if !strings.Contains(text, want) {
					Gap(t, "FuzzBrowserCountAdvice", row.Key, "%s: missing %q in %s", browserCountDiagnosticQuote, want, text)
					return
				}
			}
		}
		if row.Host != (count > 0) {
			Gap(t, "FuzzBrowserCountAdvice", row.Key, "want host diagnostic presence %t, got %d", row.Host, count)
			return
		}
		if row.Host {
			// The adapter is native TypeScript, as VIP-33 requires for an
			// operation the browser service does not supply.
			project.Files[filename] = `import { readHardwareConcurrency } from "./host.js";
export function read(): number { return readHardwareConcurrency() }`
			project.Files["host.ts"] = `/** @throws {never} */
export function readHardwareConcurrency(): number { return navigator.hardwareConcurrency }`
			fixed, err := w.Compile(t.Context(), project)
			if err != nil {
				t.Fatal(err)
			}
			defer fixed.Remove()
			for _, d := range fixed.Diagnostics {
				if d.Category() == diagnostics.CategoryError {
					Gap(t, "FuzzBrowserCountAdvice", row.Key+":adapter", "native adapter rejected: %s", d.String())
					return
				}
			}
		}
		ExpectPending(t, "FuzzBrowserCountAdvice", row.Key)
		ExpectPending(t, "FuzzBrowserCountAdvice", specCorpusKey(t))
	})
}
