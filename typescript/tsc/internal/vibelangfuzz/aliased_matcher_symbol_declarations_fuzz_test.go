package vibelangfuzz

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const aliasedMatcherSymbolQuote = "Emitted declarations that name `Symbol.customMatcher` carry the runtime type reference under [Declaration output](001-functions.md#declaration-output)."

func TestAliasedMatcherSymbolDeclarationsQuoted(t *testing.T) {
	chapterSays(t, "004-match.md", aliasedMatcherSymbolQuote)
}

func FuzzAliasedMatcherSymbolDeclarations(f *testing.F) {
	startShortBudget(f)
	chapterSays(f, "004-match.md", aliasedMatcherSymbolQuote)
	rows := []struct {
		key, source, identity string
		runtime               bool
	}{
		{"constructor-query", "const S=Symbol;export type Key=typeof S.customMatcher", "_Same<API.Key,typeof customMatcher>", true},
		{"constructor-key", "const S=Symbol;export interface P{[S.customMatcher](s:unknown):boolean}", "_Same<API.P[typeof customMatcher],(s:unknown)=>boolean>", true},
		{"destructured-query", "const {customMatcher:key}=Symbol;export type Key=typeof key", "_Same<API.Key,symbol>", true},
		{"private-alias", "const S=Symbol;type Key=typeof S.customMatcher;export const n=1", "_Same<typeof API.n,1>", false},
		{"unrelated-key", "const own=Symbol('own');const S:{readonly customMatcher:typeof own}={customMatcher:own};export interface P{[S.customMatcher](s:unknown):boolean}", "_Same<keyof API.P,typeof customMatcher> extends false?true:false", false},
		{"same-symbol-name", "import type {customMatcher as RuntimeKey} from 'vibelang-runtime';export type Protocol=typeof RuntimeKey;const customMatcher=Symbol('own');const S:{readonly customMatcher:typeof customMatcher}={customMatcher};export interface P{[S.customMatcher](s:unknown):boolean}", "_Same<keyof API.P,typeof customMatcher> extends false?true:false", true},
	}
	// Named corpus files cover each base row. These seeds exercise the
	// spelling mutations without compiling the same base inputs twice.
	f.Add("constructor-query", uint8(3))
	f.Add("same-symbol-name", uint8(1))
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
		source := row.source
		if mode&1 != 0 {
			source = strings.ReplaceAll(source, "Symbol", "S\\u0079mbol")
		}
		if mode&2 != 0 {
			source = "/* declaration */\n" + source
		}
		compile := func(config string, files map[string]string) *Result {
			r, err := w.Compile(t.Context(), Project{Config: config, Files: files})
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(r.Remove)
			return r
		}
		errors := func(r *Result) bool {
			for _, d := range r.Diagnostics {
				if d.Category() == diagnostics.CategoryError {
					return true
				}
			}
			return false
		}
		config := "{\"compilerOptions\":{\"target\":\"ES2022\",\"module\":\"NodeNext\",\"strict\":true,\"types\":[],\"skipLibCheck\":true,\"declaration\":true,\"emitDeclarationOnly\":true,\"outDir\":\"out\"}}"
		published := compile(config, map[string]string{"main.vibe": source})
		if errors(published) {
			t.Fatalf("invalid source: %v\n%s", published.Diagnostics, source)
		}
		dts, ok := published.Outputs["out/main.d.ts"]
		if !ok {
			t.Fatal("no declaration")
		}
		if strings.Contains(dts, "vibelang-runtime") != row.runtime {
			Gap(t, "FuzzAliasedMatcherSymbolDeclarations", row.key, "runtime type dependency does not match the visible API:\n%s", dts)
		}
		consumer := "{\"compilerOptions\":{\"target\":\"ES2022\",\"module\":\"NodeNext\",\"strict\":true,\"types\":[],\"skipLibCheck\":false,\"noEmit\":true},\"files\":[\"reader.ts\"]}"
		files := map[string]string{"published.d.ts": dts, "reader.ts": "import type * as API from './published.js';export type Surface=typeof API;"}
		read := compile(consumer, files)
		if errors(read) {
			Gap(t, "FuzzAliasedMatcherSymbolDeclarations", row.key, "standalone consumer rejected the declaration: %v\n%s", read.Diagnostics, dts)
		}
		files["reader.ts"] = "import type * as API from './published.js';import {customMatcher} from 'vibelang-runtime';type _Same<A,B>=(<T>()=>T extends A?1:2) extends (<T>()=>T extends B?1:2)?true:false;type _Assert<T extends true>=T;export type Check=_Assert<" + row.identity + ">;"
		identity := compile(consumer, files)
		if errors(identity) {
			Gap(t, "FuzzAliasedMatcherSymbolDeclarations", row.key, "published key differs from the native runtime symbol: %v\n%s", identity.Diagnostics, dts)
		}
	})
}
