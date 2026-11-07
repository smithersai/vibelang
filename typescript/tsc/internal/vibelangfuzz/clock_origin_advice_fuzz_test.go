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

const clockOriginDiagnosticQuote = "Every VibeLang diagnostic says what is wrong and how to fix it, with a mechanical quick fix where possible."
const clockOriginInjectionQuote = "Platform access is only through injected Effect services"
const clockOriginExample = "Number((try Clock.monotonicTimeNanos) - startNanos) / 1e6"

func clockOriginAdviceQuoted(t testing.TB) {
	t.Helper()
	chapterSays(t, "007-tooling.md", clockOriginDiagnosticQuote)
	chapterSays(t, "005-services.md", clockOriginInjectionQuote)
}
func TestClockOriginAdviceQuoted(t *testing.T) { clockOriginAdviceQuoted(t) }

func FuzzClockOriginAdvice(f *testing.F) {
	startShortBudget(f)
	clockOriginAdviceQuoted(f)
	var rows []struct {
		Key, Source string
		Host        bool
	}
	data, err := os.ReadFile(filepath.Join(Root(), "typescript/tsc/internal/vibelangfuzz/testdata/clock-origin-advice.json"))
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
		clockOriginAdviceQuoted(t)
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
			for _, want := range []string{clockOriginExample, "arbitrary origin", "same clock", "native origin", ".ts adapter"} {
				if !strings.Contains(text, want) {
					Gap(t, "FuzzClockOriginAdvice", row.Key, "%s: missing %q in %s", clockOriginDiagnosticQuote, want, text)
					return
				}
			}
		}
		if row.Host != (count > 0) {
			Gap(t, "FuzzClockOriginAdvice", row.Key, "want host diagnostic presence %t, got %d", row.Host, count)
			return
		}
		if row.Host {
			project.Files[filename] = `import { Clock, Effect } from "effect";
export effect function elapsed(startNanos: bigint): Effect.Effect<number> { return ` + clockOriginExample + ` }`
			fixed, err := w.Compile(t.Context(), project)
			if err != nil {
				t.Fatal(err)
			}
			defer fixed.Remove()
			for _, d := range fixed.Diagnostics {
				if d.Category() == diagnostics.CategoryError {
					Gap(t, "FuzzClockOriginAdvice", row.Key+":replacement", "elapsed interval rejected: %s", d.String())
					return
				}
			}
		}
		ExpectPending(t, "FuzzClockOriginAdvice", row.Key)
		ExpectPending(t, "FuzzClockOriginAdvice", specCorpusKey(t))
	})
}
