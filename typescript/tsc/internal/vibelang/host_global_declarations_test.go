package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"testing"
)

func TestUnlistedHostGlobalDeclarations(t *testing.T) {
	const source = "// expect: EK4402\nexport const reader = FileReader\nexport const hostName = name\nexport const hostStatus = status\nexport const hostOpen = open\nexport const webasm = WebAssembly\nexport const hostHeaders = globalThis.Headers\nexport const hostResponse = globalThis.Response\nexport const hostEvent = globalThis.Event\nexport const template = globalThis[`FileReader`]\nexport const repeated = globalThis.globalThis.FileReader\nexport const shorthand = { FileReader }\nexport type Reader = FileReader\nexport type ReaderConstructor = typeof FileReader\nexport type HeaderConstructor = typeof globalThis.Headers\nexport const own = { FileReader: 42 }\nexport const property = own.FileReader\nexport function local(FileReader: number): number { return FileReader }\n"
	p, file, _, _ := editorProgram(t, source)
	count := 0
	for _, d := range p.GetSemanticDiagnostics(t.Context(), file) {
		if d.Source() != diagnosticSource || d.Code() != 4402 {
			t.Errorf("unexpected diagnostic: %s", d.String())
		} else {
			count++
		}
	}
	if count != 11 {
		t.Fatalf("want eleven host-global diagnostics, got %d", count)
	}
}

func TestUnlistedHostGlobalDeclarationOrigins(t *testing.T) {
	for _, test := range []struct {
		name, source, support, supportPath, settings string
		nodePackage                                  bool
		want                                         int
	}{
		{"node global", "export const value = hostOnly", "declare var hostOnly: { value: number }", "node_modules/@types/node/index.d.ts", "", true, 1},
		{"node global augmentation", "export const value = hostOnly", "export {}; declare global { var hostOnly: { value: number } }", "node_modules/@types/node/index.d.ts", "", true, 1},
		{"project declaration", "export const value = hostOnly", "declare var hostOnly: { value: number }", "support.d.ts", "", false, 0},
		{"misleading lib filename", "export const value = hostOnly", "declare var hostOnly: { value: number }", "lib.dom.custom.d.ts", "", false, 0},
		{"ECMAScript declaration wins", "export const value = Array", "declare var Array: ArrayConstructor", "node_modules/@types/node/index.d.ts", "", true, 0},
		{"local shadow", "const hostOnly = 7; export const value = hostOnly", "declare var hostOnly: { value: number }", "node_modules/@types/node/index.d.ts", "", true, 0},
		{"type query", "export type Value = typeof hostOnly", "declare var hostOnly: { value: number }", "node_modules/@types/node/index.d.ts", "", true, 0},
		{"unrelated property", "const own = { hostOnly: 7 }; export const value = own.hostOnly", "declare var hostOnly: { value: number }", "node_modules/@types/node/index.d.ts", "", true, 0},
		{"namespace default", "export const value = Headers", "", "", "", false, 0},
		{"namespace default shorthand", "export const value = { Headers }", "", "", "", false, 0},
		{"namespace disabled shorthand", "export const value = { Headers }", "", "", ",\"vibe\":{\"effectModules\":false}", false, 1},
		{"namespace disabled", "export const value = Headers", "", "", ",\"vibe\":{\"effectModules\":false}", false, 1},
	} {
		t.Run(test.name, func(t *testing.T) {
			files := computedKeyFiles(false)
			files["/workspace/x/src/main.vibe"] = test.source
			files["/workspace/x/src/tsconfig.json"] = "{\"compilerOptions\":{\"strict\":true,\"target\":\"ESNext\",\"module\":\"NodeNext\",\"skipLibCheck\":true},\"files\":[\"main.vibe\""
			if test.supportPath != "" {
				files["/workspace/x/src/"+test.supportPath] = test.support
				files["/workspace/x/src/tsconfig.json"] += ",\"" + test.supportPath + "\""
			}
			files["/workspace/x/src/tsconfig.json"] += "]" + test.settings + "}"
			if test.nodePackage {
				files["/workspace/x/src/node_modules/@types/node/package.json"] = "{\"name\":\"@types/node\",\"types\":\"index.d.ts\"}"
			}
			program := computedKeyProgram(t, files)
			file := program.GetSourceFile(tspath.RootedFilePath("/workspace/x/src/main.vibe"))
			count := 0
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Source() != diagnosticSource || d.Code() != 4402 {
					t.Errorf("unexpected diagnostic: %s", d.String())
				} else {
					count++
				}
			}
			// rule-evidence: docs/design/vips/0033-platform-stdlib.md#858260c113fa8903 | **Amended 2026-10-29: the banned globals are derived, not listed.** A value reference in `.vibe` code is `EK4402` when the symbol it resolves to is declared in `lib.dom*.d.ts`, `lib.webworker*.d.ts`, `lib.scripthost.d.ts` or `@types/node`, not in `lib.es*.d.ts` or `lib.decorators*.d.ts`, and is not on the allowlist.
			if count != test.want {
				t.Fatalf("want %d host-global diagnostics, got %d", test.want, count)
			}
		})
	}
}

func TestHostGlobalLibraryOrigins(t *testing.T) {
	for _, test := range []struct {
		name, lib, source string
		want              int
	}{
		{"lib.dom", `"ESNext","DOM"`, "export const value = [FileReader, alert]", 2},
		{"lib.webworker", `"ESNext","WebWorker"`, "export const value = importScripts", 1},
		{"lib.scripthost", `"ESNext","ScriptHost"`, "export const value = ActiveXObject", 1},
		{"lib.es", `"ESNext","DOM"`, "export const value = [Intl, Promise, WeakRef, globalThis.Array]", 0},
		{"allowlist", `"ESNext","DOM"`, "export const value = [URL, URLSearchParams, TextEncoder, TextDecoder, structuredClone, atob, btoa, AbortController, AbortSignal]", 0},
		{"allowlisted global member that reaches the host", `"ESNext","DOM"`, "export const value = AbortSignal.timeout", 1},
		{"local shadow", `"ESNext","DOM","WebWorker"`, "export function value(alert: number, importScripts: number) { return alert + importScripts }", 0},
		{"type position", `"ESNext","DOM"`, "export type Value = typeof alert", 0},
	} {
		t.Run(test.name, func(t *testing.T) {
			files := computedKeyFiles(false)
			files["/workspace/x/src/main.vibe"] = test.source
			files["/workspace/x/src/tsconfig.json"] = `{"compilerOptions":{"strict":true,"target":"ESNext","module":"NodeNext","skipLibCheck":true,"lib":[` + test.lib + `]},"files":["main.vibe"]}`
			program := computedKeyProgram(t, files)
			file := program.GetSourceFile(tspath.RootedFilePath("/workspace/x/src/main.vibe"))
			count := 0
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Source() != diagnosticSource || d.Code() != 4402 {
					t.Errorf("unexpected diagnostic: %s", d.String())
				} else {
					count++
				}
			}
			// rule-evidence: docs/design/vips/0033-platform-stdlib.md#858260c113fa8903 | **Amended 2026-10-29: the banned globals are derived, not listed.** A value reference in `.vibe` code is `EK4402` when the symbol it resolves to is declared in `lib.dom*.d.ts`, `lib.webworker*.d.ts`, `lib.scripthost.d.ts` or `@types/node`, not in `lib.es*.d.ts` or `lib.decorators*.d.ts`, and is not on the allowlist.
			if count != test.want {
				t.Fatalf("want %d host-global diagnostics, got %d", test.want, count)
			}
		})
	}
}

// VIP-33 platform bans follow declaration origin and preserve local shadowing; rule: docs/design/vips/0033-platform-stdlib.md#858260c113fa8903

// VIP-33 platform bans follow declaration origin and preserve local shadowing; rule: docs/design/vips/0033-platform-stdlib.md#2b05842827a19b9a

// VIP-33 platform bans follow declaration origin and preserve local shadowing; rule: docs/design/vips/0033-platform-stdlib.md#99774dcf506c8546
