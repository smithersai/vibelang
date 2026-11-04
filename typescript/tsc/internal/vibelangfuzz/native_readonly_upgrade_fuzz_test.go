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

const nativeReadonlyUpgradeQuote = "A quick fix is offered only when it preserves evaluation order, coldness, types, comments, and declaration output; otherwise the diagnostic explains why it has no automatic fix."

func nativeReadonlyUpgradeQuoted(t testing.TB) {
	t.Helper()
	text, err := os.ReadFile(SpecPath("007-tooling.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(text), nativeReadonlyUpgradeQuote) {
		t.Fatalf("chapter 7 no longer says %q", nativeReadonlyUpgradeQuote)
	}
}
func TestNativeReadonlyUpgradeQuoted(t *testing.T) { nativeReadonlyUpgradeQuoted(t) }

type nativeReadonlyPair struct{ key, source string }

var nativeReadonlyPairs = []nativeReadonlyPair{
	{"smithers-options", "export interface SmithersErrorOptions { cause?: unknown; includeDocsUrl?: boolean }\n"},
	{"interface", "export interface Shape {field:number;optional?:string}\n"},
	{"alias", "export type Shape={field:string;nested:{inner:number;readonly fixed:boolean}}\n"},
	{"method", "export interface Shape {read(input:{field:string}):{result:number}}\n"},
	{"index", "export interface Shape {[key:string]:{field:number}}\n"},
	{"mapped", "export type Shape<A>={[K in keyof A]:{field:A[K]}}\n"},
	{"mutable", "export type Shape={mutable open:number;mutable?:number;nested:{mutable field:string;count:number}}\n"},
	{"class", "export class Shape {value=1;field:{inner:number}={inner:1}}\n"},
	{"namespace", "export namespace N {export interface Shape {field:number}}\n"},
	{"module", "module Native {export interface Shape {field:number}}\nimport {Shape} from Native\nexport type Public=Shape\n"},
	{"containers", "export type Shape={field:{inner:number}[];pair:[{count:string}]}\n"},
	{"explicit", "export interface Shape {readonly field:{inner:number}}\n"},
	{"keys", "export type Shape={'a-b'?:number;[Symbol.toStringTag]:string;0:number}\n"},
	{"mutable-index", "export type Shape={mutable [key:string]:{field:number}}\n"},
	{"explicit-index", "export type Shape={readonly [key:string]:{field:number}}\n"},
	{"parameter", "export function read(input:{field:number}):number{return input.field}\n"},
}

func nativeReadonlyInput(data []byte) (nativeReadonlyPair, string) {
	words := []string{"field", "café", "mutable"}
	if string(data) == nativeReadonlyPairs[0].source {
		return nativeReadonlyPairs[0], nativeReadonlyPairs[0].key + "/corpus"
	}
	parts := strings.Split(string(data), ":")
	index, word, comment := -1, 0, 0
	if len(parts) == 3 {
		for i, row := range nativeReadonlyPairs {
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
			return nativeReadonlyPair{}, ""
		}
		index, word, comment = int(data[0])%len(nativeReadonlyPairs), int(data[1])%len(words), int(data[2])%2
	}
	row := nativeReadonlyPairs[index]
	row.source = strings.ReplaceAll(row.source, "field", words[word])
	if comment != 0 {
		row.source = "/** Public API α. */\n" + row.source
	}
	return row, row.key + "/" + words[word] + "/" + strconv.Itoa(comment)
}

func FuzzNativeTypeReadonlyUpgrade(f *testing.F) {
	startShortBudget(f)
	nativeReadonlyUpgradeQuoted(f)
	for _, row := range nativeReadonlyPairs {
		for word := range 3 {
			for comment := range 2 {
				f.Add([]byte(row.key + ":" + strconv.Itoa(word) + ":" + strconv.Itoa(comment)))
			}
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		const target = "FuzzNativeTypeReadonlyUpgrade"
		row, key := nativeReadonlyInput(data)
		if key == "" {
			t.Skip("no source form selection")
		}
		files := map[string]string{"main.vibe": row.source}
		before := toolsCompile(t, w, target, files)
		defer before.Remove()
		reference := toolsCompile(t, w, target, map[string]string{"main.vibe": row.source})
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
			Gap(t, target, "declarations:"+key, "written-member declaration bytes differ\nwant:%v\ngot:%v\nsource:\n%s\nfixed:\n%s", want, got, row.source, fixed["main.vibe"])
		}
		again := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, after.Dir), vibelang.FixOptions{MigrationOnly: true})
		if again.Err != nil || len(again.Files) != 0 || len(again.Refused) != 0 {
			Gap(t, target, "fixed-point:"+key, "explicit upgrade did not reach a fixed point: %+v", again)
		}
	})
}

func TestNativeReadonlyUpgradeKeys(t *testing.T) {
	keys := []string{}
	for _, row := range nativeReadonlyPairs {
		keys = append(keys, row.key)
	}
	if len(slices.Compact(slices.Sorted(slices.Values(keys)))) != len(keys) {
		t.Fatal("duplicate row keys")
	}
	for _, row := range nativeReadonlyPairs {
		got, key := nativeReadonlyInput([]byte(row.key + ":0:0"))
		if got.source != row.source || !strings.HasPrefix(key, row.key+"/") {
			t.Fatalf("unstable key %s", row.key)
		}
	}
}
