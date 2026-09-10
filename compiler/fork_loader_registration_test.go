package compiler

import (
	"strings"
	"testing"
)

const loaderImport = "import { comptime } from \"vibelang:comptime\";\n"

func TestPinnedForkLoaderRegistrationIdentityAndExtraction(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	analyzer := backend.(LoaderRegistrationAnalyzer)
	for _, tc := range []struct{ name, file, source, sandbox string }{
		{"inline", "load.ts", loaderImport + `export default comptime.loader("yaml", (asset: unknown) => asset);`, "\nexport default (asset: unknown) => asset;"},
		{"alias", "nested/load.mts", `import { comptime as ct } from "vibelang:comptime"; export default (ct.loader)("yaml", () => 42);`, " export default () => 42;"},
		{"namespace", "load.js", `import * as tools from "vibelang:comptime"; export default tools.comptime.loader("yaml", () => 42);`, " export default () => 42;"},
		{"hoisted function", "load.ts", loaderImport + `export default comptime.loader("yaml", load); function load(a: unknown) { return a }`, "\nexport default load; function load(a: unknown) { return a }"},
		{"const function", "load.ts", loaderImport + `const load = async (a: unknown) => a; export default comptime.loader("yaml", load);`, "\nconst load = async (a: unknown) => a; export default load;"},
		{"captured state unchanged", "load.ts", loaderImport + `const state = { n: 1 }; state.n = 2; export default comptime.loader("yaml", () => state.n);`, "\nconst state = { n: 1 }; state.n = 2; export default () => state.n;"},
		{"top-level throw never executes", "load.mjs", loaderImport + `throw new Error("must not execute"); export default comptime.loader("yaml", () => 42);`, "\nthrow new Error(\"must not execute\"); export default () => 42;"},
		{"Unicode and comments", "🐱/load.ts", "// 🐱\r\n" + loaderImport + `/* retained */ export default comptime.loader("yaml", () => "猫");`, "// 🐱\r\n\n/* retained */ export default () => \"猫\";"},
		{"uppercase extension", "load.TS", loaderImport + `export default comptime.loader("yaml", () => 42);`, "\nexport default () => 42;"},
		{"Windows path label", `C:\plugins\load.ts`, loaderImport + `export default comptime.loader("yaml", () => 42);`, "\nexport default () => 42;"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			request := LoaderRegistrationRequest{Mode: "recognize", FileName: tc.file, Source: tc.source}
			got, err := analyzer.LoaderRegistration(ctx, request)
			if err != nil || !got.OK || !got.Identified || !got.Candidate || got.Registration == nil || len(got.Diagnostics) != 0 {
				t.Fatalf("got=%+v err=%v", got, err)
			}
			if got.Registration.SandboxSource != tc.sandbox || got.Registration.Type != "yaml" || got.Registration.FileName != tc.file {
				t.Fatalf("registration=%+v\nwant source=%q", got.Registration, tc.sandbox)
			}
			request.Mode = "discover"
			discovery, err := analyzer.LoaderRegistration(ctx, request)
			if err != nil || !discovery.Candidate || discovery.Identified || discovery.Registration != nil || len(discovery.Diagnostics) != 0 {
				t.Fatalf("discovery=%+v err=%v", discovery, err)
			}
		})
	}
}

func TestPinnedForkLoaderRegistrationRefusals(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	analyzer := backend.(LoaderRegistrationAnalyzer)
	for _, tc := range []struct {
		name, source, code string
		identified         bool
	}{
		{"unrelated", `const local = { loader: (t: string, fn: unknown) => fn }; export default local.loader("yaml", () => 1);`, "VCT1303", false},
		{"missing", `export default comptime.loader("yaml", () => 1);`, "VCT1304", false},
		{"missing export", loaderImport + `const load = () => 42;`, "VCT1302", false},
		{"syntax", `export default comptime.loader(`, "VCT1300", false},
		{"optional member", loaderImport + `export default comptime?.loader("yaml", () => 1);`, "VCT1305", true},
		{"optional call", loaderImport + `export default comptime.loader?.("yaml", () => 1);`, "VCT1305", true},
		{"element access", loaderImport + `export default comptime["loader"]("yaml", () => 1);`, "VCT1305", true},
		{"type arguments", loaderImport + `export default comptime.loader<never, never, never>("yaml", () => 1);`, "VCT1305", true},
		{"arity", loaderImport + `export default comptime.loader("yaml");`, "VCT1305", true},
		{"glob", loaderImport + `export default comptime.loader("*.yaml", () => 1);`, "VCT1307", true},
		{"template type", loaderImport + "export default comptime.loader(`yaml`, () => 1);", "VCT1307", true},
		{"nonliteral type", loaderImport + `const type = "yaml"; export default comptime.loader(type, () => 1);`, "VCT1307", true},
		{"uppercase type", loaderImport + `export default comptime.loader("YAML", () => 1);`, "VCT1307", true},
		{"generator", loaderImport + `export default comptime.loader("yaml", function* () {});`, "VCT1308", true},
		{"late const", loaderImport + `export default comptime.loader("yaml", load); const load = () => 1;`, "VCT1308", true},
		{"mutable binding", loaderImport + `let load = () => 1; export default comptime.loader("yaml", load);`, "VCT1308", true},
		{"await using", loaderImport + `await using load = () => 1; export default comptime.loader("yaml", load);`, "VCT1308", true},
		{"ambient declaration", loaderImport + `declare function load(): number; export default comptime.loader("yaml", load);`, "VCT1308", true},
		{"escaping intrinsic", loaderImport + `const leak = comptime; export default comptime.loader("yaml", () => 1);`, "VCT1309", true},
		{"escaping shorthand", loaderImport + `const leak = { comptime }; export default comptime.loader("yaml", () => 1);`, "VCT1309", true},
		{"escaping namespace", `import * as tools from "vibelang:comptime"; const leak = { tools }; export default tools.comptime.loader("yaml", () => 1);`, "VCT1309", true},
		{"dynamic import", loaderImport + `const load = () => import("./other.ts"); export default comptime.loader("yaml", load);`, "VCT1301", true},
		{"external import", loaderImport + `import { foo } from "./other.ts"; export default comptime.loader("yaml", () => foo);`, "VCT1301", true},
		{"type-only named import", `import { type comptime } from "vibelang:comptime"; export default comptime.loader("yaml", () => 1);`, "VCT1301", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := analyzer.LoaderRegistration(ctx, LoaderRegistrationRequest{Mode: "recognize", FileName: "load.ts", Source: tc.source})
			if err != nil || got.OK || got.Identified != tc.identified || got.Registration != nil {
				t.Fatalf("got=%+v err=%v", got, err)
			}
			found := false
			for _, d := range got.Diagnostics {
				if d.Code == tc.code {
					found = true
				}
			}
			if !found {
				t.Fatalf("missing %s: %+v", tc.code, got)
			}
		})
	}
}

func TestPinnedForkLoaderRegistrationBoundaries(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	analyzer := backend.(LoaderRegistrationAnalyzer)
	source := loaderImport + `export default comptime.loader("yaml", () => 42);`
	for _, name := range []string{"load.cts", "load.cjs", "load.tsx", "load.d.ts", "load.d.mts", "load.vibe", "load"} {
		t.Run(name, func(t *testing.T) {
			got, err := analyzer.LoaderRegistration(ctx, LoaderRegistrationRequest{Mode: "recognize", FileName: name, Source: source})
			if err != nil || got.OK || got.Identified || len(got.Diagnostics) != 1 || got.Diagnostics[0].Code != "VCT1301" {
				t.Fatalf("got=%+v err=%v", got, err)
			}
		})
	}
	for _, name := range []string{"../load.ts", "dir/../../load.ts", "../../__vibelang_loader_comptime.d.ts/../load.ts"} {
		t.Run(name, func(t *testing.T) {
			_, err := analyzer.LoaderRegistration(ctx, LoaderRegistrationRequest{Mode: "recognize", FileName: name, Source: source})
			if err == nil || !strings.Contains(err.Error(), "escaped the virtual project") {
				t.Fatalf("got %v", err)
			}
		})
	}
	for _, newline := range []string{"\n", "\r\n", "\r", "\u2028", "\u2029"} {
		t.Run("position "+newline, func(t *testing.T) {
			text := strings.TrimSpace(loaderImport) + newline + `/* 🐱 */ export default comptime.loader("*.yaml", () => 42);`
			got, err := analyzer.LoaderRegistration(ctx, LoaderRegistrationRequest{Mode: "recognize", FileName: "load.ts", Source: text})
			// 9 UTF-16 units of comment/trivia, 15 of `export default ` and
			// 16 of `comptime.loader(` put the quote at one-based column 41.
			if err != nil || len(got.Diagnostics) != 1 || got.Diagnostics[0].Line != 2 || got.Diagnostics[0].Column != 41 {
				t.Fatalf("got=%+v err=%v", got, err)
			}
		})
	}
	t.Run("budget", func(t *testing.T) {
		got, err := analyzer.LoaderRegistration(ctx, LoaderRegistrationRequest{Mode: "recognize", FileName: "load.ts", Source: source + strings.Repeat(" ", 1024*1024)})
		if err != nil || got.Candidate || got.OK || len(got.Diagnostics) != 1 || got.Diagnostics[0].Code != "VCT1301" {
			t.Fatalf("got=%+v err=%v", got, err)
		}
	})
}
