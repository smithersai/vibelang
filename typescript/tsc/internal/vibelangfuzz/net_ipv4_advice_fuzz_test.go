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

const netIPv4DiagnosticQuote = "Every VibeLang diagnostic says what is wrong and how to fix it."
const netIPv4InjectionQuote = "a `.vibe` file has no `node:*` value imports"
const netIPv4Example = "Result.isSuccess(NetAddress.ipv4FromString(address))"

func netIPv4AdviceQuoted(t testing.TB) {
	t.Helper()
	chapterSays(t, "007-tooling.md", netIPv4DiagnosticQuote)
	chapterSays(t, "005-services.md", netIPv4InjectionQuote)
}
func TestNetIPv4AdviceQuoted(t *testing.T) { netIPv4AdviceQuoted(t) }

func FuzzNetIPv4Advice(f *testing.F) {
	startShortBudget(f)
	netIPv4AdviceQuoted(f)
	var rows []struct {
		Key, Source string
		Host        bool
	}
	data, err := os.ReadFile(filepath.Join(Root(), "typescript/tsc/internal/vibelangfuzz/testdata/net-ipv4-advice.json"))
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
		netIPv4AdviceQuoted(t)
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
			"files":           []string{filename, "node.d.ts"},
		}
		if mode&2 != 0 {
			config["vibe"] = map[string]bool{"effectGlobals": false, "effectModules": false}
		}
		encoded, err := json.Marshal(config)
		if err != nil {
			t.Fatal(err)
		}
		project := Project{Config: string(encoded), Files: map[string]string{filename: source, "node.d.ts": `declare module "net" {export function isIPv4(input:string):boolean} declare module "node:net" {export function isIPv4(input:string):boolean}`, "package.json": `{"type":"module"}`}}
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
			for _, want := range []string{netIPv4Example, "boolean predicate", "either IP family"} {
				if !strings.Contains(text, want) {
					Gap(t, "FuzzNetIPv4Advice", row.Key, "%s: missing %q in %s", netIPv4DiagnosticQuote, want, text)
					return
				}
			}
		}
		if row.Host != (count > 0) {
			Gap(t, "FuzzNetIPv4Advice", row.Key, "want host diagnostic presence %t, got %d", row.Host, count)
			return
		}
		if row.Host {
			project.Files[filename] = `import { Result } from "effect";
import * as NetAddress from "effect/net/NetAddress";
export function replacement(address: string): boolean { return ` + netIPv4Example + ` }`
			fixed, err := w.Compile(t.Context(), project)
			if err != nil {
				t.Fatal(err)
			}
			defer fixed.Remove()
			for _, d := range fixed.Diagnostics {
				if d.Category() == diagnostics.CategoryError {
					Gap(t, "FuzzNetIPv4Advice", row.Key+":replacement", "boolean predicate rejected: %s", d.String())
					return
				}
			}
		}
		ExpectPending(t, "FuzzNetIPv4Advice", row.Key)
		ExpectPending(t, "FuzzNetIPv4Advice", specCorpusKey(t))
	})
}
