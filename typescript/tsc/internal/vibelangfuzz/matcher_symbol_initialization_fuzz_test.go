package vibelangfuzz

import (
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"strings"
	"testing"
)

const matcherInitializationQuote = "A type reference does not execute runtime initialization: emitted VibeLang modules using the key request the [runtime initialization dependency](008-runtime.md) first."

func TestMatcherSymbolInitializationQuoted(t *testing.T) {
	chapterSays(t, "004-match.md", matcherInitializationQuote)
}

func FuzzMatcherSymbolInitialization(f *testing.F) {
	startShortBudget(f)
	chapterSays(f, "004-match.md", matcherInitializationQuote)
	f.Add("indexed", uint8(1))
	f.Add("aliased", uint8(2))
	rows := []struct {
		key, source string
		positive    bool
	}{
		{"direct", "export function observe():boolean{return typeof Symbol.customMatcher===\"symbol\"}", true},
		{"indexed-reference", "export function observe():boolean{return typeof Symbol[\"customMatcher\"]===\"symbol\"}", true},
		{"indexed", "export function observe():boolean{return typeof Symbol[\"customMatcher\"]===\"symbol\"}", true},
		{"aliased", "const S=Symbol;export function observe():boolean{return typeof S.customMatcher===\"symbol\"}", true},
		{"destructured", "const {customMatcher:key}=Symbol;export function observe():boolean{return typeof key===\"symbol\"}", true},
		{"parameter", "function read({customMatcher:key}:typeof Symbol=Symbol):boolean{return typeof key===\"symbol\"};export function observe():boolean{return read()}", true},
		{"assignment", "let key:symbol;({customMatcher:key}=Symbol);export function observe():boolean{return typeof key===\"symbol\"}", true},
		{"parameter-type-only", "declare function read({customMatcher}:typeof Symbol):void;export function observe():boolean{return !Reflect.has(Symbol,\"customMatcher\")}", false},
		{"declaration-type-only", "declare const {customMatcher:key}:typeof Symbol;export function observe():boolean{return !Reflect.has(Symbol,\"customMatcher\")}", false},
		{"mutable-binding", "let {customMatcher:key}=Symbol;export function observe():boolean{return typeof key===\"symbol\"}", true},
		{"iteration-binding", "export function observe():boolean{for(const {customMatcher:key} of [Symbol]){return typeof key===\"symbol\"};return false}", true},
		{"nested-binding", "const {nested:{customMatcher:key}}={nested:Symbol};export function observe():boolean{return typeof key===\"symbol\"}", true},
		{"computed-assignment", "const property=\"customMatcher\" as const;let key:symbol;({[property]:key}=Symbol);export function observe():boolean{return typeof key===\"symbol\"}", true},
		{"nested-assignment", "let key:symbol;({nested:{customMatcher:key}}={nested:Symbol});export function observe():boolean{return typeof key===\"symbol\"}", true},
		{"unrelated-assignment", "const own=Symbol(\"own\");let key:symbol;({customMatcher:key}={customMatcher:own});export function observe():boolean{return key===own&&!Reflect.has(Symbol,\"customMatcher\")}", false},
		{"interface-alias", "const S=Symbol;export interface P{[S.customMatcher]():boolean};export function observe():boolean{return !Reflect.has(Symbol,\"customMatcher\")}", false},
		{"type-literal-alias", "const S=Symbol;export type P={[S.customMatcher]():boolean};export function observe():boolean{return !Reflect.has(Symbol,\"customMatcher\")}", false},
		{"ambient-class-alias", "const S=Symbol;export declare class P{[S.customMatcher]():boolean};export function observe():boolean{return !Reflect.has(Symbol,\"customMatcher\")}", false},
		{"interface-direct", "export interface P{[Symbol.customMatcher]():boolean};export function observe():boolean{return !Reflect.has(Symbol,\"customMatcher\")}", false},
		{"abstract-method", "const S=Symbol;export abstract class P{abstract [S.customMatcher]():boolean};export function observe():boolean{return !Reflect.has(Symbol,\"customMatcher\")}", false},
		{"abstract-field", "const S=Symbol;export abstract class P{abstract [S.customMatcher]:boolean};export function observe():boolean{return !Reflect.has(Symbol,\"customMatcher\")}", false},
		{"concrete-member", "const S=Symbol;abstract class P{static [S.customMatcher]():boolean{return true}};export function observe():boolean{return Reflect.has(Symbol,\"customMatcher\")}", true},
		{"type-only", "export function observe():boolean{return !Reflect.has(Symbol,\"customMatcher\")}", false},
		{"shadowed", "const Symbol={customMatcher:\"local\"};export function observe():boolean{return Symbol.customMatcher===\"local\"&&!Reflect.has(globalThis.Symbol,\"customMatcher\")}", false},
		{"unrelated", "const own=Symbol(\"own\");const o:{readonly customMatcher:typeof own}={customMatcher:own};export function observe():boolean{return o.customMatcher===own&&!Reflect.has(Symbol,\"customMatcher\")}", false},
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		if key == "" {
			return
		}
		row := rows[int(key[0])%len(rows)]
		for _, r := range rows {
			if r.key == key {
				row = r
				break
			}
		}
		prefix := "import type {customMatcher as Protocol} from \"vibelang-runtime\";export type Key=typeof Protocol;"
		source := prefix + row.source
		if row.key == "indexed-reference" {
			source = "/// <reference types=\"vibelang-runtime\" />\n" + row.source
		}
		if mode&1 != 0 {
			source = strings.ReplaceAll(source, "Symbol", "S\\u0079mbol")
		}
		if mode&2 != 0 {
			source = "/* initialization */\n" + source
		}
		config := "{\"compilerOptions\":{\"target\":\"ES2022\",\"module\":\"NodeNext\",\"strict\":true,\"types\":[],\"skipLibCheck\":true,\"outDir\":\"out\"}}"
		r, err := w.Compile(t.Context(), Project{Config: config, Files: map[string]string{"main.vibe": source}})
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		for _, d := range r.Diagnostics {
			if d.Category() == diagnostics.CategoryError {
				Gap(t, "FuzzMatcherSymbolInitialization", row.key, "source: %s%d %s", d.Source(), d.Code(), d.String())
			}
		}
		// The chapter requires an executable dependency only for value reads.
		js := r.Outputs["out/main.js"]
		if js == "" {
			t.Fatal("missing JavaScript output")
		}
		initialized := strings.Contains(js, "import \"vibelang-runtime/internal\";")
		if initialized != row.positive {
			Gap(t, "FuzzMatcherSymbolInitialization", row.key, "runtime initialization dependency=%v, want %v; emit: %s", initialized, row.positive, js)
		}
	})
}
