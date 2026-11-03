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
			if count != test.want {
				t.Fatalf("want %d host-global diagnostics, got %d", test.want, count)
			}
		})
	}
}

// VIP-33 platform bans follow declaration origin and preserve local shadowing; rule: docs/design/vips/0033-platform-stdlib.md#858260c113fa8903

// VIP-33 platform bans follow declaration origin and preserve local shadowing; rule: docs/design/vips/0033-platform-stdlib.md#2b05842827a19b9a

// VIP-33 platform bans follow declaration origin and preserve local shadowing; rule: docs/design/vips/0033-platform-stdlib.md#99774dcf506c8546
