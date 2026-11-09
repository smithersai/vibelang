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

const netIPFamilyDiagnosticQuote = "Every VibeLang diagnostic says what is wrong and how to fix it."
const netIPFamilyInjectionQuote = "a `.vibe` file has no `node:*` value imports"
const netIPFamilyExample = "Result.isSuccess(NetAddress.ipv4FromString(address)) ? 4 : Experimental.NetAddress.isIPv6(address) ? 6 : 0"

func netIPFamilyAdviceQuoted(t testing.TB) {
	t.Helper()
	chapterSays(t, "007-tooling.md", netIPFamilyDiagnosticQuote)
	chapterSays(t, "005-services.md", netIPFamilyInjectionQuote)
}
func TestNetIPFamilyAdviceQuoted(t *testing.T) { netIPFamilyAdviceQuoted(t) }

func FuzzNetIPFamilyAdvice(f *testing.F) {
	startShortBudget(f)
	netIPFamilyAdviceQuoted(f)
	var rows []struct {
		Key, Source string
		Host        bool
	}
	data, err := os.ReadFile(filepath.Join(Root(), "typescript/tsc/internal/vibelangfuzz/testdata/net-ip-family-advice.json"))
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
		netIPFamilyAdviceQuoted(t)
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
		project := Project{Config: string(encoded), Files: map[string]string{filename: source, "node.d.ts": `declare module "net" {export function isIP(input:string):number} declare module "node:net" {export function isIP(input:string):number}`, "package.json": `{"type":"module"}`}}
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
			for _, want := range []string{netIPFamilyExample, "family number 0, 4 or 6", "scoped-address syntax"} {
				if !strings.Contains(text, want) {
					Gap(t, "FuzzNetIPFamilyAdvice", row.Key, "%s: missing %q in %s", netIPFamilyDiagnosticQuote, want, text)
					return
				}
			}
		}
		if row.Host != (count > 0) {
			Gap(t, "FuzzNetIPFamilyAdvice", row.Key, "want host diagnostic presence %t, got %d", row.Host, count)
			return
		}
		if row.Host {
			project.Files[filename] = `import { Result } from "effect";
import * as NetAddress from "effect/net/NetAddress";
import * as Experimental from "vibelang-runtime/experimental";
export function replacement(address: string): 0 | 4 | 6 { return ` + netIPFamilyExample + ` }`
			fixed, err := w.Compile(t.Context(), project)
			if err != nil {
				t.Fatal(err)
			}
			defer fixed.Remove()
			for _, d := range fixed.Diagnostics {
				if d.Category() == diagnostics.CategoryError {
					Gap(t, "FuzzNetIPFamilyAdvice", row.Key+":replacement", "family number rejected: %s", d.String())
					return
				}
			}
		}
		ExpectPending(t, "FuzzNetIPFamilyAdvice", row.Key)
		ExpectPending(t, "FuzzNetIPFamilyAdvice", specCorpusKey(t))
	})
}
