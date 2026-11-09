package vibelangfuzz

import (
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

const secureRandomModuleQuote = "A module is a namespace, not a service key"
const secureRandomInjectionQuote = "Platform access is only through injected Effect services"

func secureRandomServiceAdviceQuoted(t testing.TB) {
	t.Helper()
	chapterSays(t, "007-tooling.md", "Every VibeLang diagnostic says what is wrong and how to fix it.")
	text := SpecText("005-services.md")
	for _, quote := range []string{secureRandomModuleQuote, secureRandomInjectionQuote} {
		if !strings.Contains(text, quote) {
			t.Fatalf("chapter005 no longer says %q", quote)
		}
	}
}
func TestSecureRandomServiceAdviceQuoted(t *testing.T) { secureRandomServiceAdviceQuoted(t) }
func FuzzSecureRandomServiceAdvice(f *testing.F) {
	startShortBudget(f)
	secureRandomServiceAdviceQuoted(f)
	var rows []struct{ Key, Source, Advice string }
	data, err := os.ReadFile(filepath.Join(Root(), "typescript/tsc/internal/vibelangfuzz/testdata/secure-random-service-advice.json"))
	if err != nil {
		f.Fatal(err)
	}
	if err = json.Unmarshal(data, &rows); err != nil {
		f.Fatal(err)
	}
	for _, row := range rows {
		f.Add([]byte(row.Key + "\x00\x00"))
		f.Add([]byte(row.Key + "\x00\x01"))
		if strings.Contains(row.Key, ":randomInt:") {
			for mode := byte(2); mode < 8; mode++ {
				f.Add([]byte(row.Key + "\x00" + string([]byte{mode})))
			}
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		secureRandomServiceAdviceQuoted(t)
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
		project := Project{Config: "{\"compilerOptions\":{\"strict\":true,\"target\":\"ES2022\",\"module\":\"NodeNext\",\"moduleResolution\":\"NodeNext\",\"types\":[],\"skipLibCheck\":true,\"noEmit\":true},\"files\":[\"main.vibe\",\"node.d.ts\"]}", Files: map[string]string{"main.vibe": source, "node.d.ts": "declare module \"node:crypto\" { export const randomUUID:(...args:any[])=>unknown;export const randomBytes:(...args:any[])=>unknown;export const randomInt:(...args:any[])=>unknown;export const getRandomValues:(...args:any[])=>unknown; }declare module \"crypto\" { export const randomUUID:(...args:any[])=>unknown;export const randomBytes:(...args:any[])=>unknown;export const randomInt:(...args:any[])=>unknown;export const getRandomValues:(...args:any[])=>unknown; }", "package.json": `{"type":"module"}`}}
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
				Gap(t, "FuzzSecureRandomServiceAdvice", row.Key, "%s: want %q, got %s", secureRandomModuleQuote, row.Advice, layerMergeAdviceText(d))
				return
			}
		}
		if count != 1 {
			Gap(t, "FuzzSecureRandomServiceAdvice", row.Key, "want one EK4402, got %d", count)
			return
		}
		ExpectPending(t, "FuzzSecureRandomServiceAdvice", row.Key)
		ExpectPending(t, "FuzzSecureRandomServiceAdvice", specCorpusKey(t))
	})
}
