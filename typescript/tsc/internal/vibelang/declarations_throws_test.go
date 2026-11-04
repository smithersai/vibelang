package vibelang

import (
	"fmt"
	"regexp"
	"strings"
	"testing"
)

func throwsExportSource(form uint8, async bool, documented bool, name string) (string, int) {
	modifier := ""
	if async {
		modifier = "async "
	}
	doc := ""
	if documented {
		doc = "// Section heading.\n\n/** Keeps its documentation. @deprecated use the new API */\n"
	}
	body := " { return 1 }"
	switch form % 23 {
	case 0:
		return doc + "export " + modifier + "function " + name + "()" + body, 1
	case 1:
		return doc + "export default " + modifier + "function " + name + "()" + body, 1
	case 2:
		return doc + "export const " + name + " = " + modifier + "() => 1", 1
	case 3:
		return doc + "export const " + name + " = " + modifier + "function ()" + body, 1
	case 4:
		return "export class " + name + " {\n" + doc + modifier + "method()" + body + " }", 1
	case 5:
		return "export const " + name + " = {\n" + doc + modifier + "method()" + body + " }", 1
	case 6:
		return "export class " + name + " {\n" + doc + "readonly method = " + modifier + "() => 1 }", 1
	case 7:
		result := "number"
		if async {
			result = "Promise<number>"
		}
		return doc + "export function " + name + "(n: string): " + result + "\nexport function " + name + "(n: number): " + result + "\nexport " + modifier + "function " + name + "(n: string | number)" + body, 2
	case 8:
		return doc + modifier + "function " + name + "()" + body + "; export { " + name + " as renamed }", 1
	case 9:
		return "export namespace " + name + " {\n" + doc + "export " + modifier + "function nested()" + body + " }", 1
	case 10:
		return doc + "export type " + name + " = () => number", 1
	case 11:
		return "export interface " + name + " {\n" + doc + "method(): number; (): number; new(): object; callback: () => number }", 4
	case 12:
		return "export const " + name + " = {\n" + doc + "callback: " + modifier + "() => 1 }", 1
	case 13:
		return doc + "export default " + modifier + "() => 1", 1
	case 14:
		return "export class " + name + " {\n" + doc + "constructor(readonly value: number) {} }", 1
	case 15:
		result := "number"
		if async {
			result = "Promise<number>"
		}
		return "export class " + name + " {\n" + doc + "method(n: string): " + result + "; method(n: number): " + result + "; " + modifier + "method(n: string | number)" + body + " }", 2
	case 16:
		return doc + "export const " + name + " = " + modifier + "() => 1, second = " + modifier + "() => 2", 2
	case 17:
		return doc + "export " + modifier + "function* " + name + "() { yield 1 }", 1
	case 18:
		return doc + "export function " + name + "() { return " + modifier + "() => 1 }", 2
	case 19:
		return doc + "export " + modifier + "function " + name + "(callback: () => number) { return callback() }", 2
	case 20:
		return doc + "export function " + name + "() { return { method() { return 1 } } }", 2
	case 21:
		return "export const " + name + " = {\n" + doc + modifier + "method() { return 1 } } as const", 1
	default:
		return doc + "export class " + name + " { private " + modifier + "method() { return 1 } private arrow = " + modifier + "() => 1; protected " + modifier + "kept() { return 1 } exposed() { return this.method() } }", 2
	}
}

// TypeScript reads prose and tags from the last JSDoc block before a
// declaration only (checked against tsc 5.9.3 getDocumentationComment): with
// `/** prose */ /** @throws {never} */` it reports no prose. Each source here
// has at most one block per declaration, so two adjacent blocks mean the
// generated contract was split from the authored documentation.
var adjacentDocBlocks = regexp.MustCompile(`\*/\s*/\*\*`)

func TestVIP27EveryExport(t *testing.T) {
	for form := range uint8(23) {
		for _, async := range []bool{false, true} {
			for _, documented := range []bool{false, true} {
				t.Run(fmt.Sprintf("form%d/async%t/doc%t", form, async, documented), func(t *testing.T) {
					source, want := throwsExportSource(form, async, documented, "sample")
					files := computedKeyFiles(false)
					files["/workspace/x/src/main.vibe"] = source
					dts := emitDeclarations(t, files)
					if got := strings.Count(dts, "@throws {never}"); got != want {
						t.Fatalf("VIP-27: got %d generated tags, want %d\nsource: %s\ndeclaration:\n%s", got, want, source, dts)
					}
					if adjacentDocBlocks.MatchString(dts) {
						t.Fatalf("VIP-27: a separate generated block hides the authored JSDoc from TypeScript, which reads only the last block:\n%s", dts)
					}
					if documented && (strings.Contains(dts, "/*//") || strings.Count(dts, "Keeps its documentation.") != 1 || !strings.Contains(dts, "@deprecated")) {
						t.Fatalf("lost authored documentation:\n%s", dts)
					}
				})
			}
		}
	}
}

func TestVIP27EffectAndForeignExports(t *testing.T) {
	for _, source := range []string{
		"export effect function sample() { return 1 }",
		"export const sample = effect () => 1",
		"export class Sample { effect method() { return 1 } }",
		"module native { export function foreign() { throw new Error('foreign') } }; import { foreign } from native; export { foreign }",
		"export { foreign } from './foreign.js'",
		"import { foreign } from './foreign.js'; export const sample = foreign",
	} {
		files := computedKeyFiles(false)
		files["/workspace/x/src/main.vibe"] = source
		files["/workspace/x/src/foreign.ts"] = "/** @throws {unknown} */\nexport function foreign() { return 1 }"
		dts := emitDeclarations(t, files)
		if strings.Contains(dts, "@throws {never}") {
			t.Fatalf("invented a contract for %s:\n%s", source, dts)
		}
	}
}

// The VIP-27 oracle is one tag on every emitted local non-Effect signature,
// regardless of source export spelling, async modifier or authored prose.
func FuzzVIP27ExportThrows(f *testing.F) {
	for form := range uint8(23) {
		f.Add(form, false, false)
		f.Add(form, true, true)
	}
	f.Fuzz(func(t *testing.T, form uint8, async, documented bool) {
		source, want := throwsExportSource(form, async, documented, "sample")
		files := computedKeyFiles(false)
		files["/workspace/x/src/main.vibe"] = source
		dts := emitDeclarations(t, files)
		if got := strings.Count(dts, "@throws {never}"); got != want {
			t.Fatalf("VIP-27: got %d tags, want %d\n%s\n%s", got, want, source, dts)
		}
		if adjacentDocBlocks.MatchString(dts) {
			t.Fatalf("VIP-27: generated block hides authored JSDoc\n%s\n%s", source, dts)
		}
	})
}
