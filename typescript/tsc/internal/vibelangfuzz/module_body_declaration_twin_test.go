package vibelangfuzz

import (
	"fmt"
	"maps"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

// FuzzModuleBodyDeclarationTwin compiles a .vibe or .vibex file holding a
// module body and its TypeScript twin, the body moved to a sibling file named
// by the body's output stem, and requires every declaration file of the
// package output to be byte-identical to stock tsc's. The oracle is the twin
// rule quoted below: moving the body changes no declaration, and the body's
// declarations are TypeScript's own emit of it under the shared stem. So a
// converted package's published headers are exactly the extracted twin's.
const moduleBodyDeclarationTwinTarget = "FuzzModuleBodyDeclarationTwin"

var moduleBodyDeclarationTwinQuotes = []struct{ chapter, text string }{
	{"001-functions.md", "moving it to a sibling `.ts` file (`.tsx` for a body in `.vibex`) with its external-module classification preserved and replacing `from name` with that file's specifier changes no diagnostic, type, emitted statement, declaration or run-time observation."},
	{"001-functions.md", "JavaScript, declarations, maps and loader requests share that stem"},
	{"../vips/0040-module-declarations.md", "A body's declarations are TypeScript's own declaration emit of it"},
}

func TestModuleBodyDeclarationTwinQuoted(t *testing.T) {
	for _, quote := range moduleBodyDeclarationTwinQuotes {
		if !strings.Contains(SpecText(quote.chapter), quote.text) {
			t.Fatalf("%s no longer says %q", quote.chapter, quote.text)
		}
	}
}

// A body form: the body's text, its exported values and types, and a type
// the containing file can write with them.
type moduleBodyTwinForm struct {
	key, body     string
	values, types []string
	use           string
}

var moduleBodyTwinForms = []moduleBodyTwinForm{
	// The migrate flow's platform split: a throwing function the module re-exports.
	{"throws-function", "/** Parses a port. @throws {RangeError} when empty */\nexport function port(raw: string): number {\n  if (!raw) throw new RangeError(\"empty\")\n  return raw.length\n}\n", []string{"port"}, nil, "typeof port"},
	{"interface", "export interface Options {\n  readonly strict: boolean\n  name?: string\n  nested: { readonly deep: number[] }\n}\n", nil, []string{"Options"}, "Options"},
	{"class-private", "export class Parser {\n  #seen = 0\n  private hidden = 1\n  protected kept = \"k\"\n  static count = 0\n  constructor(readonly limit: number) {}\n  get seen(): number { return this.#seen }\n  parse(raw: string): number { this.#seen++; return raw.length + this.hidden }\n}\n", []string{"Parser"}, nil, "Parser"},
	{"enum", "export enum Color { Red, Green = \"g\", Blue = 4 }\n", []string{"Color"}, nil, "Color"},
	{"unique-symbol", "export const TypeId: unique symbol = Symbol(\"T\")\nexport class Value { readonly [TypeId] = true }\n", []string{"TypeId", "Value"}, nil, "Value[typeof TypeId]"},
	{"generic-alias", "export type Pair<A, B = A> = readonly [A, B]\nexport type Keys<T> = { [K in keyof T]-?: K }[keyof T]\n", nil, []string{"Pair", "Keys"}, "Pair<Keys<{ a: 1 }>>"},
	{"namespace", "export namespace Shapes {\n  export const unit = 1\n  export interface Box { size: number }\n}\n", []string{"Shapes"}, nil, "Shapes.Box"},
	{"overloads", "export function pick(x: string): string\nexport function pick(x: number): number\nexport function pick(x: string | number) { return x }\n", []string{"pick"}, nil, "typeof pick"},
	{"inferred", "export const config = { retries: 3, name: \"x\" as const, list: [1, 2] }\nexport function make() { return { ok: true as const, at: config.retries } }\n", []string{"config", "make"}, nil, "ReturnType<typeof make>"},
	{"abstract", "export abstract class Base<T> {\n  abstract run(input: T): Promise<T>\n  accessor label = \"\"\n}\n", []string{"Base"}, nil, "Base<string>"},
}

// How the containing file reaches the body. NAME is the body's specifier.
var moduleBodyTwinOwners = []struct {
	key  string
	text func(form moduleBodyTwinForm) string
}{
	{"named", func(form moduleBodyTwinForm) string {
		var lines []string
		if len(form.values) > 0 {
			lines = append(lines, "export { "+strings.Join(form.values, ", ")+" } from NAME")
		}
		if len(form.types) > 0 {
			lines = append(lines, "export type { "+strings.Join(form.types, ", ")+" } from NAME")
		}
		return strings.Join(lines, "\n")
	}},
	{"star", func(moduleBodyTwinForm) string { return "export * from NAME" }},
	{"renamed", func(form moduleBodyTwinForm) string {
		var lines []string
		for _, name := range form.values {
			lines = append(lines, "export { "+name+" as "+name+"Out } from NAME")
		}
		for _, name := range form.types {
			lines = append(lines, "export type { "+name+" as "+name+"Out } from NAME")
		}
		return strings.Join(lines, "\n")
	}},
	{"namespace", func(moduleBodyTwinForm) string { return "export * as Body from NAME" }},
	{"uses", func(form moduleBodyTwinForm) string {
		var lines []string
		if len(form.values) > 0 {
			lines = append(lines, "import { "+strings.Join(form.values, ", ")+" } from NAME")
		}
		if len(form.types) > 0 {
			lines = append(lines, "import type { "+strings.Join(form.types, ", ")+" } from NAME")
		}
		return strings.Join(append(lines, "export type Use = "+form.use), "\n")
	}},
}

func moduleBodyTwinConfig(t *testing.T, dir string) {
	t.Helper()
	moduleSidecarWrite(t, dir, "package.json", "{\"type\":\"module\"}")
	moduleSidecarWrite(t, dir, "tsconfig.json", `{"compilerOptions":{"target":"ES2022","module":"nodenext","strict":true,"declaration":true,"outDir":"dist","rootDir":"src","skipLibCheck":true,"types":[],"jsx":"preserve"},"include":["src"]}`)
}

// moduleBodyTwinDeclarations maps each declaration file under dir/dist to its text.
func moduleBodyTwinDeclarations(t *testing.T, dir string) map[string]string {
	t.Helper()
	files := map[string]string{}
	root := filepath.Join(dir, "dist")
	err := filepath.WalkDir(root, func(path string, entry os.DirEntry, err error) error {
		if err != nil || entry.IsDir() || !strings.HasSuffix(path, ".d.ts") {
			return err
		}
		text, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		relative, err := filepath.Rel(root, path)
		files[filepath.ToSlash(relative)] = string(text)
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	return files
}

func FuzzModuleBodyDeclarationTwin(f *testing.F) {
	startShortBudget(f)
	for i, form := range moduleBodyTwinForms {
		// Each owner form, each extension and each name spelling at least once.
		f.Add(form.key, uint8(i%4|(i%len(moduleBodyTwinOwners))<<2))
	}
	binary, stock := cliBuild(f, f.TempDir()), StockTypeScript(f)
	f.Fuzz(func(t *testing.T, key string, variant uint8) {
		TestModuleBodyDeclarationTwinQuoted(t)
		index := slices.IndexFunc(moduleBodyTwinForms, func(form moduleBodyTwinForm) bool { return form.key == key })
		if index < 0 {
			if key == "" {
				return
			}
			index = int(key[0]) % len(moduleBodyTwinForms)
		}
		form := moduleBodyTwinForms[index]
		owner := moduleBodyTwinOwners[int(variant>>2)%len(moduleBodyTwinOwners)]
		source, native, output := "main.vibe", ".ts", ".js"
		if variant&1 != 0 {
			// TypeScript writes a .tsx file's JavaScript as .jsx under "jsx": "preserve".
			source, native, output = "main.vibex", ".tsx", ".jsx"
		}
		// Über checks the stem's encoding: the twin's file is main.vibe.-dc-ber.ts.
		name, encoded := "parse", "parse"
		if variant&2 != 0 {
			name, encoded = "Über", "-dc-ber"
		}
		stem := source + "." + encoded
		ownerText := owner.text(form) + "\nexport const answer: number = 42\n"
		vibe, twin := t.TempDir(), t.TempDir()
		moduleBodyTwinConfig(t, vibe)
		moduleBodyTwinConfig(t, twin)
		moduleSidecarWrite(t, vibe, "src/"+source, "module "+name+" {\n"+form.body+"}\n"+strings.ReplaceAll(ownerText, "NAME", name))
		moduleSidecarWrite(t, twin, "src/"+stem+native, form.body)
		moduleSidecarWrite(t, twin, "src/main"+native, strings.ReplaceAll(ownerText, "NAME", "\"./"+stem+output+"\""))
		gapKey := fmt.Sprintf("%s/%s/%s", form.key, owner.key, strings.TrimPrefix(native, "."))

		control := cliExec(stock, twin, []string{"-p", "tsconfig.json", "--pretty", "false"}, "", Project{})
		if control.Hung != "" || control.Status != 0 {
			t.Fatalf("invalid TypeScript twin %s: status%d hung=%q\n%s%s", gapKey, control.Status, control.Hung, control.Stdout, control.Stderr)
		}
		result := cliExec(binary, vibe, []string{"-p", "tsconfig.json", "--pretty", "false"}, "", Project{})
		if result.Hung != "" {
			t.Fatalf("%s did not finish: %s", gapKey, result.Hung)
		}
		if result.Status != 0 {
			Gap(t, moduleBodyDeclarationTwinTarget, gapKey, "VIP-40: %q; the body's twin compiles, the module does not: status%d\n%s%s", moduleBodyDeclarationTwinQuotes[0].text, result.Status, result.Stdout, result.Stderr)
			return
		}
		want, got := moduleBodyTwinDeclarations(t, twin), moduleBodyTwinDeclarations(t, vibe)
		if _, ok := want[stem+".d.ts"]; !ok {
			t.Fatalf("stock tsc wrote no %s.d.ts: %v", stem, slices.Sorted(maps.Keys(want)))
		}
		for _, file := range slices.Sorted(maps.Keys(want)) {
			if got[file] != want[file] {
				Gap(t, moduleBodyDeclarationTwinTarget, gapKey, "%q and %q; %s differs from the TypeScript twin's\n--- twin\n%s--- module\n%s", moduleBodyDeclarationTwinQuotes[0].text, moduleBodyDeclarationTwinQuotes[2].text, file, want[file], got[file])
				return
			}
		}
		if extra := slices.DeleteFunc(slices.Sorted(maps.Keys(got)), func(file string) bool { _, ok := want[file]; return ok }); len(extra) > 0 {
			Gap(t, moduleBodyDeclarationTwinTarget, gapKey, "%q; the module writes declarations its twin does not: %v", moduleBodyDeclarationTwinQuotes[1].text, extra)
			return
		}
		ExpectPending(t, moduleBodyDeclarationTwinTarget, gapKey)
	})
}
