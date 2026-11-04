package vibelangfuzz

import (
	"context"
	_ "embed"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

const genericNeverOverloadTarget = "FuzzGenericNeverOverloadAssignment"
const genericNeverOverloadQuote = "a type without `@throws` admits only `never`"

//go:embed testdata/corpus/foldkit-struct-evolve-generic-overload.ts
var genericNeverOverloadWitness string

var genericNeverOverloadKeys = []string{
	"foldkit-struct-evolve-generic-overload", "struct-evolve-generic-alias",
	"struct-evolve-generic-return", "struct-evolve-generic-argument",
	"struct-evolve-typeof", "generic-never-single", "generic-error-single",
}

func TestGenericNeverOverloadAssignmentQuoted(t *testing.T) {
	r4Quoted(t, "003-failures.md", genericNeverOverloadQuote, callbackOverloadQuote, assignabilityQuote)
}

func genericNeverOverloadProject(key, extension string) Project {
	prefix, _, ok := strings.Cut(genericNeverOverloadWitness, "export const direct:")
	if !ok {
		panic("generic overload witness has no assignment")
	}
	handler := "{ <O, const T extends Transform<O>>(o: O, t: T): unknown }"
	source := genericNeverOverloadWitness
	files := map[string]string{"foreign.d.ts": "type Evolver<S> = { readonly [K in keyof S]?: (value: S[K]) => unknown };\nexport declare namespace Struct { const evolve: {\n/** @throws {never} */\n<S extends object, E extends Evolver<S>>(e: E): (self: S) => S;\n/** @throws {never} */\n<S extends object, E extends Evolver<S>>(self: S, e: E): S;\n}; }\n"}
	switch key {
	case "struct-evolve-generic-alias":
		source = prefix + "type Handler = " + handler + ";\nexport const direct: Handler = Struct.evolve;\n"
	case "struct-evolve-generic-return":
		source = prefix + "export function direct(): " + handler + " { return Struct.evolve; }\n"
	case "struct-evolve-generic-argument":
		source = prefix + "declare function accept(value: " + handler + "): void;\naccept(Struct.evolve);\n"
	case "struct-evolve-typeof":
		source = prefix + "export const direct: typeof Struct.evolve = Struct.evolve;\n"
	case "generic-never-single", "generic-error-single":
		bound := "never"
		if key == "generic-error-single" {
			bound = "Error"
		}
		files["foreign.d.ts"] = "/** @throws {" + bound + "} */\nexport declare function source<T>(value: T): T;\n"
		source = "import { source } from \"./foreign.js\";\nexport const direct: { <T>(value: T): T } = source;\n"
	}
	// The raw package witness remains a separate stock control. The generated
	// admission oracle supplies explicit per-overload contracts, so its expected
	// result does not depend on informational npm inventory annotations.
	source = strings.Replace(source, "from \"effect\"", "from \"./foreign.js\"", 1)
	main := "main." + extension
	files[main] = source
	config := fmt.Sprintf(`{"compilerOptions":{"target":"ESNext","module":"ESNext","moduleResolution":"Bundler","strict":true,"noEmit":true,"types":[],"skipLibCheck":true},"files":[%q],"vibe":{"effectGlobals":false,"effectModules":false}}`, main)
	return Project{Files: files, Config: config}
}

func migrationFindingStockCodes(t *testing.T, w *Workspace, tsc string, p Project) []string {
	t.Helper()
	dir, err := toolsWrite(w, p)
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(dir)
	ctx, cancel := context.WithTimeout(t.Context(), HangLimit)
	defer cancel()
	cmd := exec.CommandContext(ctx, "node", tsc, "-p", filepath.Join(dir, "tsconfig.json"), "--pretty", "false")
	output, err := cmd.CombinedOutput()
	var codes []string
	for line := range strings.SplitSeq(string(output), "\n") {
		if m := stockDiagnostic.FindStringSubmatch(line); m != nil && m[4] == "error" {
			codes = append(codes, "TS"+m[5])
		}
	}
	if ctx.Err() != nil || err != nil && len(codes) == 0 {
		t.Fatalf("stock TypeScript failed: %v; %v\n%s\n%s", ctx.Err(), err, output, Archive(p.Files))
	}
	return codes
}

func TestGenericNeverOverloadStockWitness(t *testing.T) {
	w := NewWorkspace(t)
	p := genericNeverOverloadProject("foldkit-struct-evolve-generic-overload", "ts")
	p.Files = map[string]string{"main.ts": genericNeverOverloadWitness}
	if codes := migrationFindingStockCodes(t, w, effectAliasStock(t), p); len(codes) != 0 {
		t.Fatalf("raw package witness must compile with stock TypeScript: %v", codes)
	}
}

func FuzzGenericNeverOverloadAssignment(f *testing.F) {
	startShortBudget(f)
	r4Quoted(f, "003-failures.md", genericNeverOverloadQuote, callbackOverloadQuote, assignabilityQuote)
	tsc := effectAliasStock(f)
	f.Add([]byte("key:struct-evolve-typeof"))
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		key := genericNeverOverloadKeys[r4Pick(data, genericNeverOverloadKeys)]
		if codes := migrationFindingStockCodes(t, w, tsc, genericNeverOverloadProject(key, "ts")); len(codes) != 0 {
			t.Fatalf("stock TypeScript must admit %s: %v", key, codes)
		}
		t.Logf("stock TypeScript 5.9.3: %s: zero diagnostics", key)
		p := genericNeverOverloadProject(key, "vibe")
		r, err := w.Compile(t.Context(), p)
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		got := r4Errors(r.Diagnostics)
		var want []string
		if key == "generic-error-single" {
			want = []string{"EK0402"}
		}
		for _, code := range got {
			if code != "EK0402" {
				t.Fatalf("%s: unexpected diagnostics %v\n%s", key, got, Archive(p.Files))
			}
		}
		if !slices.Equal(got, want) {
			Gap(t, genericNeverOverloadTarget, "contract:"+key, "Chapter 3: %s; %s; %s\nwant %v, got %v\n%s", genericNeverOverloadQuote, callbackOverloadQuote, assignabilityQuote, want, got, Archive(p.Files))
		}
		ExpectPending(t, genericNeverOverloadTarget, "contract:"+key)
		ExpectPending(t, genericNeverOverloadTarget, specCorpusKey(t))
	})
}
