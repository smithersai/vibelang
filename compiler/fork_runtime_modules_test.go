package compiler

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"unicode/utf16"
)

func TestPinnedForkRuntimeModuleFacts(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	analyzer := backend.(RuntimeModulesAnalyzer)
	inspect := func(t *testing.T, name, source string, deferred bool) RuntimeModuleFile {
		t.Helper()
		got, err := analyzer.RuntimeModules(ctx, RuntimeModulesRequest{Files: []RuntimeModuleSource{{Path: name, Text: source, DeferComputedDynamicSpecifier: deferred}}})
		if err != nil || len(got.Files) != 1 {
			t.Fatalf("got=%+v err=%v", got, err)
		}
		if got.Files[0].Path != name || len(got.Files[0].Resolutions) != 0 {
			t.Fatalf("invented resolution: %+v", got)
		}
		return got.Files[0]
	}
	for _, tc := range []struct {
		name, source, kind                   string
		typeOnly, initialization, attributes bool
	}{
		{"bare", `import "./lib";`, "import", false, true, false},
		{"default", `import value from "./lib";`, "import", false, true, false},
		{"named", `import { value } from "./lib";`, "import", false, true, false},
		{"empty import", `import {} from "./lib";`, "import", false, true, false},
		{"type import", `import type { Value } from "./lib";`, "import", true, false, false},
		{"named type import", `import { type Value } from "./lib";`, "import", true, false, false},
		{"mixed import", `import value, { type Value } from "./lib";`, "import", false, true, false},
		{"attributes", `import value from "./lib" with { type: "json" };`, "import", false, true, true},
		{"export", `export { value } from "./lib";`, "export", false, true, false},
		{"empty export", `export {} from "./lib";`, "export", false, true, false},
		{"wildcard", `export * from "./lib";`, "export", false, true, false},
		{"namespace", `export * as value from "./lib";`, "export", false, true, false},
		{"type export", `export type { Value } from "./lib";`, "export", true, false, false},
		{"named type export", `export { type Value } from "./lib";`, "export", true, false, false},
		{"type wildcard", `export type * from "./lib";`, "export", true, false, false},
		{"import equals", `import value = require("./lib");`, "import-equals", false, true, false},
		{"type import equals", `import type value = require("./lib");`, "import-equals", true, false, false},
		{"dynamic", `import("./lib");`, "dynamic-import", false, true, false},
		{"dynamic template", "import(`./lib`);", "dynamic-import", false, true, false},
		{"dynamic attributes", `import("./lib", {with:{type:"json"}});`, "dynamic-import", false, true, true},
		{"require", `require("./lib");`, "require", false, true, false},
		{"require template", "require(`./lib`);", "require", false, true, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := inspect(t, "module.ts", tc.source, false)
			if len(got.Edges) != 1 || len(got.Diagnostics) != 0 || len(got.ParseDiagnostics) != 0 {
				t.Fatalf("%+v", got)
			}
			edge := got.Edges[0]
			if edge.Kind != tc.kind || edge.Specifier != "./lib" || edge.TypeOnly != tc.typeOnly || edge.ModuleInitialization != tc.initialization || edge.Attributes != tc.attributes || !strings.Contains(tc.source[edge.Start:edge.End], "./lib") {
				t.Fatalf("%+v", got)
			}
		})
	}
	for _, tc := range []struct {
		name, source   string
		initialization bool
	}{
		{"top level promise", `const p = import("./lib"); void p;`, true},
		{"top level await", `const x = await import("./lib");`, true},
		{"IIFE", `(() => require("./lib"))();`, true},
		{"local called", `function load() { return require("./lib") } load();`, true},
		{"exported called", `export function load() { return require("./lib") } load();`, true},
		{"object getter", `const x = { get y() { return require("./lib") } }; x.y;`, true},
		{"object member", `export const x = { load: () => require("./lib") };`, true},
		{"parenthesized binding", `export const load = (() => require("./lib"));`, true},
		{"shorthand escape", `export const load = () => require("./lib"); const x = { load };`, true},
		{"class static initializer", `export class X { static x = require("./lib"); }`, true},
		{"class computed member", `export class X { [require("./lib")]() {} }`, true},
		{"class decorator", `@decorate(require("./lib")) export class X {}`, true},
		{"function exported", `export function load() { return require("./lib") }`, false},
		{"arrow exported", `export const load = () => require("./lib");`, false},
		{"export clause", `function load() { return require("./lib") } export { load };`, false},
		{"default anonymous", `export default function() { return require("./lib") }`, false},
		{"class method", `export class X { load() { return require("./lib") } }`, false},
		{"parameter default", `export function load(x = require("./lib")) { return x; }`, false},
		{"nested IIFE deferred", `export function load() { return (() => require("./lib"))() }`, false},
		{"type reference erased", `export function load() { return require("./lib") } type L = typeof load;`, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := inspect(t, "module.ts", tc.source, false)
			if len(got.Edges) != 1 || len(got.Diagnostics) != 0 || got.Edges[0].ModuleInitialization != tc.initialization {
				t.Fatalf("%+v", got)
			}
		})
	}
	for _, tc := range []struct {
		name, source, message string
		deferred              bool
	}{
		{"computed import", `import(name)`, "module specifier must be a string literal", false},
		{"missing import", `import()`, "dynamic import must have one string literal", false},
		{"extra import", `import("./lib", {}, {})`, "dynamic import must have one string literal", false},
		{"nonobject attributes", `import("./lib", attrs)`, "dynamic import attributes must be an object literal", false},
		{"computed require", `require(name)`, "module specifier must be a string literal", false},
		{"extra require", `require("./lib", {})`, "require must have one string literal", false},
		{"require alias", `const r = require;`, "require may not be aliased", false},
		{"require property", `require.resolve("./lib");`, "require may not be aliased", false},
		{"require parameter conservatively refused", `function f(require) {}`, "require may not be aliased", false},
		{"computed import delegated", `import(name)`, "", true},
		{"attributes not delegated", `import(name, attrs)`, "dynamic import attributes must be an object literal", true},
		{"arity not delegated", `import()`, "dynamic import must have one string literal", true},
		{"recovery diagnostics separate", `const x = ;`, "", false},
		{"type queries are not edges", `type T = import("./lib").T;`, "", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := inspect(t, "module.ts", tc.source, tc.deferred)
			if len(got.Edges) != 0 || (len(got.Diagnostics) == 0) != (tc.message == "") {
				t.Fatalf("%+v", got)
			}
			if tc.message != "" && !strings.Contains(got.Diagnostics[0].Message, tc.message) {
				t.Fatalf("%+v", got)
			}
			if tc.name == "recovery diagnostics separate" && (len(got.ParseDiagnostics) != 1 || got.ParseDiagnostics[0].Code != "TS1109") {
				t.Fatalf("%+v", got)
			}
		})
	}
	for _, tc := range []struct {
		name, source string
		trusted      bool
	}{
		{"exact", "/** @module @throws {never} */\nexport const x = 1;", true},
		{"only marker", "/** @module @throws {never} */", true},
		{"empty", "", false},
		{"separate tags", "/** @module */\n/** @throws {never} */\nexport const x = 1;", false},
		{"last doc preserved", "/** @module @throws {never} */\n/** documentation */\nexport const x = 1;", true},
		{"line comment fake", "// /** @module @throws {never} */\nexport const x = 1;", false},
		{"block comment fake", "/* /** @module @throws {never} */\nexport const x = 1;", false},
		{"not leading", "export const x = 1;\n/** @module @throws {never} */", false},
		{"case sensitive", "/** @module @THROWS {never} */\nexport const x = 1;", false},
		{"type case sensitive", "/** @module @throws {Never} */\nexport const x = 1;", false},
		{"module boundary", "/** @moduleResolution @throws {never} */\nexport const x = 1;", false},
		{"NBSP", "/** @module @throws {\u00a0never} */\nexport const x = 1;", false},
		{"decorated tag", "/** @module @throws\n * {never} */\nexport const x = 1;", false},
		{"four whitespaces", "/** @module @throws\n\r\t { never } */\nexport const x = 1;", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := inspect(t, "module.ts", tc.source, false); got.LeadingNoThrow != tc.trusted {
				t.Fatalf("%+v", got)
			}
		})
	}
	for _, newline := range []string{"\n", "\r\n", "\r", "\u2028", "\u2029"} {
		t.Run("UTF16 "+newline, func(t *testing.T) {
			prefix := "// 🦀" + newline
			source := prefix + `if (const x = 1; x) { const p = import("./\u006cab"); }`
			got := inspect(t, "module.vibe", source, false)
			start := strings.Index(source, `"./`)
			if len(got.ParseDiagnostics) != 0 || len(got.Edges) != 1 || got.Edges[0].Specifier != "./lab" || got.Edges[0].Start != len(utf16.Encode([]rune(source[:start]))) || got.FirstStatement != (AssetImportPosition{Start: len(utf16.Encode([]rune(prefix))), Line: 2, Column: 1}) {
				t.Fatalf("%+v", got)
			}
			bad := inspect(t, "module.ts", prefix+`const 🦀x = require;`, false)
			if len(bad.Diagnostics) != 1 || bad.Diagnostics[0].Line != 2 || bad.Diagnostics[0].Column != 13 {
				t.Fatalf("%+v", bad)
			}
		})
	}
}

func TestPinnedForkRuntimeModuleResolution(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	analyzer := backend.(RuntimeModulesAnalyzer)
	root := t.TempDir()
	write := func(name, source string) {
		t.Helper()
		name = filepath.Join(root, name)
		if err := os.MkdirAll(filepath.Dir(name), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(name, []byte(source), 0600); err != nil {
			t.Fatal(err)
		}
	}
	for name, source := range map[string]string{
		"value.ts": "export const x = 42;", "directory/index.ts": "", "js.mjs": "", "js.d.mts": "", "typed.d.ts": "",
		"both.js": "", "both.ts": "", "pkg/package.json": `{"types":"types.d.ts","main":"runtime.js"}`, "pkg/types.d.ts": "", "pkg/runtime.js": "",
		"🦀.ts": "", "\ue000.ts": "",
	} {
		write(name, source)
	}
	resolve := func(t *testing.T, name, source string) RuntimeModuleFile {
		t.Helper()
		got, err := analyzer.RuntimeModules(ctx, RuntimeModulesRequest{ResolutionRoot: root, Files: []RuntimeModuleSource{{Path: name, Text: source}}})
		if err != nil || len(got.Files) != 1 || len(got.Files[0].Diagnostics) != 0 {
			t.Fatalf("got=%+v err=%v", got, err)
		}
		return got.Files[0]
	}
	for _, tc := range []struct{ specifier, runtimePath, typePath, message string }{
		{"./value", "value.ts", "value.ts", ""}, {"./value.js", "value.ts", "value.ts", ""}, {"./value.ts", "value.ts", "value.ts", ""},
		{"./directory", "directory/index.ts", "directory/index.ts", ""}, {"./js.mjs", "js.mjs", "js.d.mts", ""},
		{"./typed.js", "typed.d.ts", "typed.d.ts", ""}, {"./pkg", "pkg/types.d.ts", "pkg/types.d.ts", ""},
		{"./absent", "", "", ""}, {"../outside", "", "", "outside the project root"},
		{"./both.js", "", "", "ambiguous"},
	} {
		t.Run(tc.specifier, func(t *testing.T) {
			got := resolve(t, "main.ts", `import "`+tc.specifier+`";`)
			if len(got.Resolutions) != 1 {
				t.Fatalf("%+v", got)
			}
			answer := got.Resolutions[0]
			if answer.Specifier != tc.specifier || answer.RuntimePath != tc.runtimePath || answer.TypePath != tc.typePath || (tc.message == "" && answer.Message != "") || (tc.message != "" && !strings.Contains(answer.Message, tc.message)) {
				t.Fatalf("%+v", answer)
			}
		})
	}
	t.Run("implicit declaration companion", func(t *testing.T) {
		got := resolve(t, "js.mjs", "export const x = 42;")
		if !reflect.DeepEqual(got.Resolutions, []RuntimeModuleResolution{{Specifier: "./js.mjs", RuntimePath: "js.mjs", TypePath: "js.d.mts"}}) {
			t.Fatalf("%+v", got)
		}
	})
	t.Run("UTF16 resolution order and deduplication", func(t *testing.T) {
		got := resolve(t, "main.ts", "import './\ue000'; import './🦀'; import './🦀';")
		if len(got.Resolutions) != 2 || got.Resolutions[0].Specifier != "./🦀" || got.Resolutions[1].Specifier != "./\ue000" {
			t.Fatalf("%+v", got)
		}
	})
	t.Run("symbolic declaration aliases never disappear through cached fallback", func(t *testing.T) {
		write("alias.js", "export const x = 42;")
		if err := os.Symlink(filepath.Join(root, "typed.d.ts"), filepath.Join(root, "alias.d.ts")); err != nil {
			t.Fatal(err)
		}
		got, err := analyzer.RuntimeModules(ctx, RuntimeModulesRequest{ResolutionRoot: root, Files: []RuntimeModuleSource{
			{Path: "main.ts", Text: `import "./alias.js"; import "./alias";`}, {Path: "other.ts", Text: `import "./alias.js";`},
		}})
		if err != nil {
			t.Fatal(err)
		}
		for _, file := range got.Files {
			for _, answer := range file.Resolutions {
				if !strings.Contains(answer.Message, "symbolic-link alias") || answer.RuntimePath != "" || answer.TypePath != "" {
					t.Fatalf("%+v", got)
				}
			}
		}
	})
	t.Run("symbolic directory outside root is refused", func(t *testing.T) {
		outside := t.TempDir()
		if err := os.WriteFile(filepath.Join(outside, "index.ts"), []byte("export const x = 1;"), 0600); err != nil {
			t.Fatal(err)
		}
		if err := os.Symlink(outside, filepath.Join(root, "escape")); err != nil {
			t.Fatal(err)
		}
		got := resolve(t, "main.ts", `import "./escape";`)
		if len(got.Resolutions) != 1 || !strings.Contains(got.Resolutions[0].Message, "symbolic-link alias") || got.Resolutions[0].RuntimePath != "" {
			t.Fatalf("%+v", got)
		}
	})
	for _, source := range []RuntimeModuleSource{{Path: "../outside.ts"}, {Path: "./main.ts"}, {Path: "/main.ts"}, {Path: "main\x00.ts"}, {Path: "main.json"}} {
		t.Run("invalid input "+source.Path, func(t *testing.T) {
			if _, err := analyzer.RuntimeModules(ctx, RuntimeModulesRequest{Files: []RuntimeModuleSource{source}}); err == nil {
				t.Fatal("invalid path accepted")
			}
		})
	}
	for _, request := range []RuntimeModulesRequest{{}, {Files: make([]RuntimeModuleSource, 4097)}, {Files: []RuntimeModuleSource{{Path: "a.ts"}, {Path: "a.ts"}}}, {Files: []RuntimeModuleSource{{Path: "a.ts"}}, ResolutionRoot: "relative"}} {
		t.Run("invalid request", func(t *testing.T) {
			if _, err := analyzer.RuntimeModules(ctx, request); err == nil {
				t.Fatal("invalid request accepted")
			}
		})
	}
}
