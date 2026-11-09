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

const hrtimeDiagnosticQuote = "Every VibeLang diagnostic says what is wrong and how to fix it."
const hrtimeInjectionQuote = "Platform access is only through injected Effect services"
const hrtimeExample = "Duration.toHrTime(try Clock.monotonicTimeNanos)"

func hrtimeAdviceQuoted(t testing.TB) {
	t.Helper()
	chapterSays(t, "007-tooling.md", hrtimeDiagnosticQuote)
	chapterSays(t, "005-services.md", hrtimeInjectionQuote)
}
func TestHrtimeAdviceQuoted(t *testing.T) { hrtimeAdviceQuoted(t) }

func FuzzHrtimeAdvice(f *testing.F) {
	startShortBudget(f)
	hrtimeAdviceQuoted(f)
	var rows []struct {
		Key, Source string
		Host, Tuple bool
	}
	data, err := os.ReadFile(filepath.Join(Root(), "typescript/tsc/internal/vibelangfuzz/testdata/hrtime-advice.json"))
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
		hrtimeAdviceQuoted(t)
		parts := strings.SplitN(string(data), "\x00", 2)
		i := slices.IndexFunc(rows, func(row struct {
			Key, Source string
			Host, Tuple bool
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
			"files":           []string{filename, "node_modules/@types/node/index.d.ts"},
		}
		if mode&2 != 0 {
			config["vibe"] = map[string]bool{"effectGlobals": false, "effectModules": false}
		}
		encoded, err := json.Marshal(config)
		if err != nil {
			t.Fatal(err)
		}
		project := Project{Config: string(encoded), Files: map[string]string{filename: source, "package.json": `{"type":"module"}`, "node_modules/@types/node/package.json": `{"name":"@types/node","types":"index.d.ts"}`, "node_modules/@types/node/index.d.ts": `declare namespace NodeJS { interface HRTime { (previous?:[number,number]):[number,number]; bigint():bigint } }
declare var process: {hrtime:NodeJS.HRTime};
declare module "process" {export const hrtime:NodeJS.HRTime}
declare module "node:process" {export const hrtime:NodeJS.HRTime}`}}
		example, contract := hrtimeExample, "[number, number]"
		if !row.Tuple {
			example, contract = "try Clock.monotonicTimeNanos", "bigint"
		}
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
			for _, want := range []string{example, "same clock", "origin"} {
				if !strings.Contains(text, want) {
					Gap(t, "FuzzHrtimeAdvice", row.Key, "%s: missing %q in %s", hrtimeDiagnosticQuote, want, text)
					return
				}
			}
			if !row.Tuple && strings.Contains(text, "Duration.toHrTime") {
				Gap(t, "FuzzHrtimeAdvice", row.Key, "bigint advice converts to a tuple: %s", text)
				return
			}
		}
		if row.Host != (count > 0) {
			Gap(t, "FuzzHrtimeAdvice", row.Key, "want host diagnostic presence %t, got %d", row.Host, count)
			return
		}
		if row.Host {
			project.Files[filename] = `import { Clock, Duration, Effect } from "effect";
export effect function read(): Effect.Effect<` + contract + `> { return ` + example + ` }`
			fixed, err := w.Compile(t.Context(), project)
			if err != nil {
				t.Fatal(err)
			}
			defer fixed.Remove()
			for _, d := range fixed.Diagnostics {
				if d.Category() == diagnostics.CategoryError {
					Gap(t, "FuzzHrtimeAdvice", row.Key+":replacement", "replacement contract rejected: %s", d.String())
					return
				}
			}
		}
		ExpectPending(t, "FuzzHrtimeAdvice", row.Key)
		ExpectPending(t, "FuzzHrtimeAdvice", specCorpusKey(t))
	})
}
