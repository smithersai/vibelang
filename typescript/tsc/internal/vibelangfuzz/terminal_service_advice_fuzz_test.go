package vibelangfuzz

import (
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

const terminalModuleQuote = "A module is a namespace, not a service key"
const terminalInjectionQuote = "Platform access is only through injected Effect services"

func terminalServiceAdviceQuoted(t testing.TB) {
	t.Helper()
	text := SpecText("005-services.md")
	for _, quote := range []string{terminalModuleQuote, terminalInjectionQuote} {
		if !strings.Contains(text, quote) {
			t.Fatalf("chapter005 no longer says %q", quote)
		}
	}
}
func TestTerminalServiceAdviceQuoted(t *testing.T) { terminalServiceAdviceQuoted(t) }
func FuzzTerminalServiceAdvice(f *testing.F) {
	startShortBudget(f)
	terminalServiceAdviceQuoted(f)
	var rows []struct{ Key, Source, Advice string }
	data, err := os.ReadFile(filepath.Join(Root(), "typescript/tsc/internal/vibelangfuzz/testdata/terminal-service-advice.json"))
	if err != nil {
		f.Fatal(err)
	}
	if err = json.Unmarshal(data, &rows); err != nil {
		f.Fatal(err)
	}
	for _, row := range rows {
		f.Add([]byte(row.Key + "\x00\x00"))
		f.Add([]byte(row.Key + "\x00\x01"))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		terminalServiceAdviceQuoted(t)
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
		r, err := w.Compile(t.Context(), Project{Config: "{\"compilerOptions\":{\"strict\":true,\"target\":\"ES2022\",\"module\":\"NodeNext\",\"moduleResolution\":\"NodeNext\",\"types\":[],\"skipLibCheck\":true,\"noEmit\":true},\"files\":[\"main.vibe\",\"node.d.ts\",\"node_modules/@types/node/index.d.ts\"]}", Files: map[string]string{"main.vibe": source, "node.d.ts": "declare module \"node:readline\" { export const createInterface:any; }declare module \"readline\" { export const createInterface:any; }declare module \"node:readline/promises\" { export const createInterface:any; }declare module \"readline/promises\" { export const createInterface:any; }declare module \"node:tty\" { export const createInterface:any; }declare module \"tty\" { export const createInterface:any; }", "node_modules/@types/node/index.d.ts": "declare var process: { argv: string[]; stdout: unknown; stderr: unknown; stdin: unknown };", "node_modules/@types/node/package.json": `{"name":"@types/node","types":"index.d.ts"}`, "package.json": `{"type":"module"}`}})
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
				Gap(t, "FuzzTerminalServiceAdvice", row.Key, "%s: want %q, got %s", terminalModuleQuote, row.Advice, layerMergeAdviceText(d))
				return
			}
		}
		if count != 1 {
			Gap(t, "FuzzTerminalServiceAdvice", row.Key, "want one EK4402, got %d", count)
			return
		}
		ExpectPending(t, "FuzzTerminalServiceAdvice", row.Key)
		ExpectPending(t, "FuzzTerminalServiceAdvice", specCorpusKey(t))
	})
}
