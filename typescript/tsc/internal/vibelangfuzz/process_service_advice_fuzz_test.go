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

const processAdviceQuote = "Every VibeLang diagnostic says what is wrong and how to fix it."

const processInjectionQuote = "Platform access is only through injected Effect services"

func processServiceAdviceQuoted(t testing.TB) {
	t.Helper()
	chapterSays(t, "007-tooling.md", processAdviceQuote)
	text := SpecText("005-services.md")
	for _, quote := range []string{processInjectionQuote} {
		if !strings.Contains(text, quote) {
			t.Fatalf("chapter005 no longer says %q", quote)
		}
	}
}
func TestProcessServiceAdviceQuoted(t *testing.T) { processServiceAdviceQuoted(t) }
func FuzzProcessServiceAdvice(f *testing.F) {
	startShortBudget(f)
	processServiceAdviceQuoted(f)
	var rows []struct{ Key, Source, Advice string }
	data, err := os.ReadFile(filepath.Join(Root(), "typescript/tsc/internal/vibelangfuzz/testdata/process-service-advice.json"))
	if err != nil {
		f.Fatal(err)
	}
	if err = json.Unmarshal(data, &rows); err != nil {
		f.Fatal(err)
	}
	for _, row := range rows {
		f.Add([]byte(row.Key + "\x00\x00"))
		f.Add([]byte(row.Key + "\x00\x01"))
		if strings.Contains(row.Key, ":version:") {
			for mode := byte(2); mode < 8; mode++ {
				f.Add([]byte(row.Key + "\x00" + string([]byte{mode})))
			}
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		processServiceAdviceQuoted(t)
		parts := strings.SplitN(string(data), "\x00", 2)
		i := slices.IndexFunc(rows, func(row struct{ Key, Source, Advice string }) bool { return row.Key == parts[0] })
		if i < 0 {
			i = len(data) % len(rows)
		}
		row := rows[i]
		source := row.Source
		if len(parts) > 1 && len(parts[1]) > 0 && parts[1][0]&1 != 0 {
			source = "// retain namespace lookup through trivia\n" + strings.ReplaceAll(source, "Native", "Nâtive")
		}
		project := Project{Config: "{\"compilerOptions\":{\"strict\":true,\"target\":\"ES2022\",\"module\":\"NodeNext\",\"moduleResolution\":\"NodeNext\",\"types\":[],\"skipLibCheck\":true,\"noEmit\":true},\"files\":[\"main.vibe\",\"node.d.ts\",\"node_modules/@types/node/index.d.ts\"]}", Files: map[string]string{"main.vibe": source, "node.d.ts": "declare module \"node:os\" { export const hostname:any;export const availableParallelism:any;export const platform:any;export const arch:any; }declare module \"os\" { export const hostname:any;export const availableParallelism:any;export const platform:any;export const arch:any; }declare module \"node:process\" { export const pid:any;export const platform:any;export const arch:any;export const execPath:any;export const versions:any;export const version:any;const Native: {version: string};export default Native;export const memoryUsage:any;export const kill:any; }declare module \"process\" { export const pid:any;export const platform:any;export const arch:any;export const execPath:any;export const versions:any;export const version:any;const Native: {version: string};export default Native;export const memoryUsage:any;export const kill:any; }", "node_modules/@types/node/index.d.ts": "declare var process: {pid:any;platform:any;arch:any;execPath:any;versions:any;version:any;memoryUsage:any;kill:any;};", "node_modules/@types/node/package.json": `{"name":"@types/node","types":"index.d.ts"}`, "package.json": `{"type":"module"}`}}
		mode := byte(0)
		if len(parts) > 1 && len(parts[1]) > 0 {
			mode = parts[1][0]
		}
		if mode&2 != 0 {
			project.Config = strings.Replace(project.Config, "{", `{"vibe":{"effectGlobals":false,"effectModules":false},`, 1)
		}
		if mode&4 != 0 {
			project.Files["main.vibex"] = project.Files["main.vibe"]
			delete(project.Files, "main.vibe")
			project.Config = strings.Replace(project.Config, "main.vibe", "main.vibex", 1)
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
			if !strings.Contains(layerMergeAdviceText(d), row.Advice) {
				Gap(t, "FuzzProcessServiceAdvice", row.Key, "%s: want %q, got %s", processInjectionQuote, row.Advice, layerMergeAdviceText(d))
				return
			}
		}
		if count != 1 {
			Gap(t, "FuzzProcessServiceAdvice", row.Key, "want one EK4402, got %d", count)
			return
		}
		if strings.Contains(row.Key, ":version:") {
			file := "main.vibe"
			if mode&4 != 0 {
				file = "main.vibex"
			}
			project.Files[file] = `import { Effect } from "effect";
import * as Experimental from "vibelang-runtime/experimental";
export effect function replacement(): Effect.Effect<string, never, Experimental.Process.Process> { return ` + row.Advice + ` }`
			fixed, err := w.Compile(t.Context(), project)
			if err != nil {
				t.Fatal(err)
			}
			defer fixed.Remove()
			for _, d := range fixed.Diagnostics {
				if d.Category() == diagnostics.CategoryError {
					Gap(t, "FuzzProcessServiceAdvice", row.Key+":replacement", "string replacement rejected: %s", d.String())
					return
				}
			}
		}
		ExpectPending(t, "FuzzProcessServiceAdvice", row.Key)
		ExpectPending(t, "FuzzProcessServiceAdvice", specCorpusKey(t))
	})
}
