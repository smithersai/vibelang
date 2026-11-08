package vibelang

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const untaggedConstructorLibrary = `export class Calm { constructor(readonly n: number) {} }
export class Safe {
  /** @throws {never} */
  constructor(readonly n: number) {}
}
export class Boom {
  /** @throws {RangeError} */
  constructor(readonly n: number) {}
}
export class Implicit { readonly n = 1 }
export type Ctor = new (n: number) => { n: number }
export type TaggedCtor = {
  /** @throws {unknown} */
  new (n: number): { n: number }
}
export declare function build(ctor: Ctor): number
export declare function buildTagged(ctor: TaggedCtor): number
`

// A foreign constructor with no @throws tag throws unknown, so its class fits
// only a construct signature that admits unknown, as an unannotated function
// fits only such a callback type. A class that declares no constructor stays
// untracked, and a VibeLang class throws never.
func TestUntaggedConstructorValueContract(t *testing.T) {
	for _, row := range []struct {
		name, body string
		want       int
	}{
		{"assigned", "export const c: Ctor = Calm", 1},
		{"argument", "export const n = build(Calm)", 1},
		{"tagged-class", "export const c: Ctor = Boom", 1},
		{"admitted", "export const c: TaggedCtor = Calm", 0},
		{"admitted-argument", "export const n = buildTagged(Calm)", 0},
		{"never", "export const c: Ctor = Safe", 0},
		{"implicit-constructor", "export const c: new () => { n: number } = Implicit", 0},
		{"vibelang-class", "class Local { constructor(readonly n: number) {} }\nexport const c: Ctor = Local", 0},
	} {
		for _, ext := range []string{"ts", "d.ts"} {
			t.Run(row.name+"/"+ext, func(t *testing.T) {
				lib := untaggedConstructorLibrary
				if ext == "d.ts" {
					lib = "export declare class Calm { readonly n: number; constructor(n: number) }\n" +
						"export declare class Safe { readonly n: number;\n  /** @throws {never} */\n  constructor(n: number) }\n" +
						"export declare class Boom { readonly n: number;\n  /** @throws {RangeError} */\n  constructor(n: number) }\n" +
						"export declare class Implicit { readonly n: number }\n" +
						"export type Ctor = new (n: number) => { n: number }\n" +
						"export type TaggedCtor = {\n  /** @throws {unknown} */\n  new (n: number): { n: number }\n}\n" +
						"export declare function build(ctor: Ctor): number\nexport declare function buildTagged(ctor: TaggedCtor): number\n"
				}
				source := "import { Calm, Safe, Boom, Implicit, build, buildTagged } from \"./lib.js\"\nimport type { Ctor, TaggedCtor } from \"./lib.js\"\n" + row.body + "\n"
				p, f, _, _ := requirementIdentityProgram(t, source, map[string]string{"lib." + ext: lib})
				for _, d := range p.GetSyntacticDiagnostics(t.Context(), f) {
					t.Errorf("syntax: %s", d.String())
				}
				got := 0
				for _, d := range p.GetSemanticDiagnostics(t.Context(), f) {
					if d.Category() != diagnostics.CategoryError {
						continue
					}
					if d.Source() == diagnosticSource && d.Code() == 402 {
						got++
						continue
					}
					t.Errorf("unexpected: %s", d.String())
				}
				if got != row.want {
					t.Errorf("EK0402 got %d, want %d", got, row.want)
				}
			})
		}
	}
}
