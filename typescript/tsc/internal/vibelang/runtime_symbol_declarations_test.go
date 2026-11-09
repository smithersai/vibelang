package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestRetainedMatcherSymbolDeclarations(t *testing.T) {
	rows := []struct {
		name, source string
		runtime      bool
	}{
		{"type-query", "export type Key = typeof Symbol.customMatcher", true},
		{"escaped-query", "export type Key = typeof S\\u0079mbol.customMatcher", true},
		{"return-query", "export function key():typeof Symbol.customMatcher{return Symbol.customMatcher}", true},
		{"annotated-value", "export const key:typeof Symbol.customMatcher=Symbol.customMatcher", true},
		{"interface-key", "export interface P{[Symbol.customMatcher](s:unknown):boolean}", true},
		{"class-key", "export class P{static [Symbol.customMatcher](s:unknown):boolean{return true}}", true},
		{"object-key", "export const P={[Symbol.customMatcher](s:unknown):boolean{return true}}", true},
		{"nested-object-key", "export const P={nested:{[Symbol.customMatcher](s:unknown):boolean{return true}}}", true},
		{"mixed-keys", "export const A={[customMatcher](s:unknown):boolean{return true}}; export const B={[Symbol.customMatcher](s:unknown):boolean{return true}}", true},
		{"shadowed-import-name", "import \"vibelang-runtime\";const customMatcher=Symbol('other');export const Other={[customMatcher](s:unknown):boolean{return true}};export const P={[Symbol.customMatcher](s:unknown):boolean{return true}}", true},
		{"private-query", "type Key=typeof Symbol.customMatcher;export const n=1", false},
		{"private-key", "const P={[Symbol.customMatcher](s:unknown):boolean{return true}};export const n=1", false},
		{"local-Symbol", "const own=globalThis.Symbol('own');declare const Symbol:{readonly customMatcher:typeof own};export interface P{[Symbol.customMatcher](s:unknown):boolean}", false},
		{"ordinary-symbol", "export interface P{[Symbol.iterator]():Iterator<number>}", false},
	}
	for _, linked := range []bool{false, true} {
		for _, row := range rows {
			name := row.name
			if linked {
				name += "/linked"
			}
			t.Run(name, func(t *testing.T) {
				files := computedKeyFiles(linked)
				for path, text := range files {
					if strings.HasSuffix(path, "/match.d.ts") {
						files[path] = text + "\ndeclare global{interface SymbolConstructor{readonly customMatcher:typeof customMatcher}}"
					}
				}
				files["/workspace/x/src/main.vibe"] = row.source
				dts := emitDeclarations(t, files)
				files["/workspace/x/src/main.d.ts"] = dts
				delete(files, "/workspace/x/src/main.vibe")
				files["/workspace/x/src/consumer.ts"] = "import * as value from './main.js';export {value}"
				files["/workspace/x/src/tsconfig.json"] = "{\"compilerOptions\":{\"strict\":true,\"skipLibCheck\":false,\"module\":\"NodeNext\",\"noEmit\":true,\"types\":[]},\"files\":[\"consumer.ts\"]}"
				p := computedKeyProgram(t, files)
				for _, d := range p.GetSemanticDiagnostics(t.Context(), nil) {
					if d.Category() == diagnostics.CategoryError {
						t.Errorf("standalone consumer: %s\n%s", d.String(), dts)
					}
				}
				has := strings.Contains(dts, "vibelang-runtime")
				if has != row.runtime {
					t.Errorf("runtime import = %t, want %t\n%s", has, row.runtime, dts)
				}
			})
		}
	}
}
