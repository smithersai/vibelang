package vibelangfuzz

import (
	"os"
	"slices"
	"strconv"
	"strings"
	"testing"
)

const nativeReadonlyUpgradeQuote = "Diagnostics retain their existing codes, categories and eligibility; compiling a file does not apply a source rewrite."

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
