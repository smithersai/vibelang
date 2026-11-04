package vibelangfuzz

import (
	"maps"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

const serviceReadonlyUpgradeQuote = "A quick fix is offered only when it preserves evaluation order, coldness, types, comments, and declaration output"

func serviceReadonlyUpgradeQuoted(t testing.TB) {
	t.Helper()
	text, err := os.ReadFile(SpecPath("007-tooling.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(text), serviceReadonlyUpgradeQuote) {
		t.Fatalf("chapter 7 no longer says %q", serviceReadonlyUpgradeQuote)
	}
}
func TestServiceReadonlyUpgradeQuoted(t *testing.T) { serviceReadonlyUpgradeQuoted(t) }

type serviceReadonlyPair struct{ key, source, legacy string }

var serviceReadonlyPairs = []serviceReadonlyPair{
	{"smithers-agent-jobs", "export service AgentJobs { start: () => void; readonly stop: () => void }\n", "export service AgentJobs { readonly start: () => void; readonly stop: () => void }\n"},
	{"body", "export service Jobs { field: number }\n", "export service Jobs { readonly field: number }\n"},
	{"nested", "export service Jobs { field: { inner: number; readonly fixed: string } }\n", "export service Jobs { readonly field: { readonly inner: number; readonly fixed: string } }\n"},
	{"callable", "export service Jobs { field: (input: { value: number }) => { result: number } }\n", "export service Jobs { readonly field: (input: { readonly value: number }) => { readonly result: number } }\n"},
	{"method", "export service Jobs { run(input: { field: number }): { result: number }!never }\n", "export service Jobs { run(input: { readonly field: number }): { readonly result: number }!never }\n"},
	{"static", "export service Jobs { field: number; static readonly defaultValue: () => { field: number } = () => ({ field: 1 }) }\n", "export service Jobs { readonly field: number; static readonly defaultValue: () => { readonly field: number } = () => ({ field: 1 }) }\n"},
	{"whole", "export service Jobs: { field: number; nested: { value: string } } { static readonly key = \"jobs\" }\n", "export service Jobs: { readonly field: number; readonly nested: { readonly value: string } } { static readonly key = \"jobs\" }\n"},
	{"namespace", "export namespace N { export service Jobs { field: number } }\n", "export namespace N { export service Jobs { readonly field: number } }\n"},
	{"containers", "export service Jobs { field: { value: string }[]; pair: [{ count: number }] }\n", "export service Jobs { readonly field: { readonly value: string }[]; readonly pair: [{ readonly count: number }] }\n"},
	{"index", "export service Jobs { field: { [key: string]: { value: number } } }\n", "export service Jobs { readonly field: { readonly [key: string]: { readonly value: number } } }\n"},
	{"mapped", "export service Jobs { field: { [K in \"a\" | \"b\"]: { value: number } } }\n", "export service Jobs { readonly field: { [K in \"a\" | \"b\"]: { readonly value: number } } }\n"},
	{"nested-mutable", "export service Jobs { field: { mutable open: number; mutable: number; count: number } }\n", "export service Jobs { readonly field: { mutable open: number; readonly mutable: number; readonly count: number } }\n"},
	{"explicit", "export service Jobs { readonly field: number }\n", "export service Jobs { readonly field: number }\n"},
}

func serviceReadonlyInput(data []byte) (serviceReadonlyPair, string) {
	words := []string{"field", "café", "mutable"}
	if string(data) == serviceReadonlyPairs[0].source {
		return serviceReadonlyPairs[0], serviceReadonlyPairs[0].key + "/corpus"
	}
	parts := strings.Split(string(data), ":")
	index, word, comment := -1, 0, 0
	if len(parts) == 3 {
		for i, row := range serviceReadonlyPairs {
			if row.key == parts[0] {
				index = i
			}
		}
		w, err := strconv.Atoi(parts[1])
		c, err2 := strconv.Atoi(parts[2])
		if err != nil || err2 != nil || w < 0 || w >= len(words) || c < 0 || c > 1 {
			index = -1
		} else {
			word, comment = w, c
		}
	}
	if index < 0 {
		if len(data) < 3 {
			return serviceReadonlyPair{}, ""
		}
		index, word, comment = int(data[0])%len(serviceReadonlyPairs), int(data[1])%len(words), int(data[2])%2
	}
	row := serviceReadonlyPairs[index]
	row.source = strings.ReplaceAll(row.source, "field", words[word])
	row.legacy = strings.ReplaceAll(row.legacy, "field", words[word])
	if comment != 0 {
		row.source = "/** Public API α. */\n" + row.source
		row.legacy = "/** Public API α. */\n" + row.legacy
	}
	return row, row.key + "/" + words[word] + "/" + strconv.Itoa(comment)
}

func FuzzServiceReadonlyUpgrade(f *testing.F) {
	startShortBudget(f)
	serviceReadonlyUpgradeQuoted(f)
	for _, row := range serviceReadonlyPairs {
		for word := range 3 {
			for comment := range 2 {
				f.Add([]byte(row.key + ":" + strconv.Itoa(word) + ":" + strconv.Itoa(comment)))
			}
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		const target = "FuzzServiceReadonlyUpgrade"
		row, key := serviceReadonlyInput(data)
		if key == "" {
			t.Skip("no source form selection")
		}
		manifest := `{"name":"smithers-service-readonly","type":"module"}`
		files := map[string]string{"main.vibe": row.source, "package.json": manifest}
		before := toolsCompile(t, w, target, files)
		defer before.Remove()
		reference := toolsCompile(t, w, target, map[string]string{"main.vibe": row.legacy, "package.json": manifest})
		defer reference.Remove()
		if !toolsErrorFree(before) || !toolsErrorFree(reference) {
			t.Fatalf("invalid generator %s: %v / %v", key, SortedKeys(Keys(before.Dir, before.Diagnostics)), SortedKeys(Keys(reference.Dir, reference.Diagnostics)))
		}
		result := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, before.Dir), vibelang.FixOptions{MigrationOnly: true})
		if result.Err != nil || len(result.Refused) != 0 {
			Gap(t, target, "refused:"+key, "explicit upgrade refused %s: %+v", key, result)
		}
		fixed := maps.Clone(files)
		for name, file := range result.Files {
			rel := strings.TrimPrefix(name.AsString(), filepath.ToSlash(before.Dir)+"/")
			if rel != "main.vibe" {
				Gap(t, target, "scope:"+key, "upgrade wrote unowned file %s", rel)
			}
			fixed[rel] = file.Text
		}
		after := toolsCompile(t, w, target, fixed)
		defer after.Remove()
		if !toolsErrorFree(after) {
			Gap(t, target, "compile:"+key, "upgrade introduced errors: %v\n%s", SortedKeys(Keys(after.Dir, after.Diagnostics)), fixed["main.vibe"])
		}
		declarations := func(r *Result) map[string]string {
			out := map[string]string{}
			for name, text := range r.Outputs {
				if strings.HasSuffix(name, ".d.ts") {
					out[name] = text
				}
			}
			return out
		}
		got, want := declarations(after), declarations(reference)
		if len(got) == 0 || !maps.Equal(got, want) {
			Gap(t, target, "declarations:"+key, "old readonly declaration bytes differ\nwant:%v\ngot:%v\nsource:\n%s\nfixed:\n%s", want, got, row.source, fixed["main.vibe"])
		}
		again := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, after.Dir), vibelang.FixOptions{MigrationOnly: true})
		if again.Err != nil || len(again.Files) != 0 || len(again.Refused) != 0 {
			Gap(t, target, "fixed-point:"+key, "explicit upgrade did not reach a fixed point: %+v", again)
		}
	})
}

func TestServiceReadonlyUpgradeKeys(t *testing.T) {
	keys := []string{}
	for _, row := range serviceReadonlyPairs {
		keys = append(keys, row.key)
	}
	if len(slices.Compact(slices.Sorted(slices.Values(keys)))) != len(keys) {
		t.Fatal("duplicate row keys")
	}
	for _, row := range serviceReadonlyPairs {
		got, key := serviceReadonlyInput([]byte(row.key + ":0:0"))
		if got.source != row.source || !strings.HasPrefix(key, row.key+"/") {
			t.Fatalf("unstable key %s", row.key)
		}
	}
}
