package vibelangfuzz

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

const moduleSidecarResolutionTarget = "FuzzModuleSidecarResolution"

var moduleSidecarResolutionQuotes = []string{
	"Relative imports in relocated sidecars resolve from the actual output location",
	"Another project's checker does not inherit the producer's `rootDirs`.",
}

func moduleSidecarResolutionQuoted(t testing.TB) {
	for _, quote := range moduleSidecarResolutionQuotes {
		if !strings.Contains(SpecText("007-tooling.md"), quote) {
			t.Fatalf("Chapter 007 no longer says %q", quote)
		}
	}
	const sidecars = "Their compatibility sidecars stay distinct, \x60App.d.vibe.ts\x60 and \x60App.d.vibex.ts\x60."
	if !strings.Contains(SpecText("../vips/0039-vibex.md"), sidecars) {
		t.Fatalf("VIP-39 no longer says %q", sidecars)
	}
	const quote = "A body's declarations are TypeScript's own declaration emit of it"
	if !strings.Contains(SpecText("../vips/0040-module-declarations.md"), quote) {
		t.Fatalf("VIP-40 no longer says %q", quote)
	}
}

var moduleSidecarResolutionKeys = []string{
	"reexport/adjacent", "reexport/relocated", "alias/adjacent", "alias/relocated",
	"star/adjacent", "star/relocated", "inferred/adjacent", "inferred/relocated",
}

func moduleSidecarResolutionKey(key string, variant uint8) string {
	for _, candidate := range moduleSidecarResolutionKeys {
		if candidate == key {
			return key
		}
	}
	return moduleSidecarResolutionKeys[int(variant)%len(moduleSidecarResolutionKeys)]
}

func moduleSidecarStockCheck(t *testing.T, stock, dir string) (string, error) {
	t.Helper()
	config := `{"compilerOptions":{"target":"ES2022","module":"ESNext","moduleResolution":"Bundler","strict":true,"skipLibCheck":false,"types":[],"allowArbitraryExtensions":true,"noEmit":true},"files":["consumer.ts"]}`
	if err := os.WriteFile(filepath.Join(dir, "tsconfig.json"), []byte(config), 0600); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(t.Context(), HangLimit)
	defer cancel()
	cmd := exec.CommandContext(ctx, stock, "-p", "tsconfig.json", "--pretty", "false")
	cmd.Dir = dir
	output, err := cmd.CombinedOutput()
	if ctx.Err() != nil {
		t.Fatalf("stock consumer timed out: %v", ctx.Err())
	}
	return string(output), err
}

func moduleSidecarWrite(t *testing.T, dir, name, text string) {
	t.Helper()
	path := filepath.Join(dir, filepath.FromSlash(name))
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(text), 0600); err != nil {
		t.Fatal(err)
	}
}

// R28 OPUS-1: only emitted declarations reach this independent consumer.
// No .vibe source, producer config, rootDirs or compiler virtual file can
// rescue a bad relative import. This checks resolvability, not the unsettled
// exact placement/filename spelling of a body declaration.
func checkModuleSidecarResolution(t *testing.T, w *Workspace, stock, key string, variant uint8) {
	t.Helper()
	parts := strings.Split(key, "/")
	suffix, nested := "vibe", "src/"
	if variant&1 != 0 {
		suffix = "vibex"
	}
	if variant&2 != 0 {
		nested = "src/deep/"
	}
	name := nested + "main." + suffix
	sidecar := nested + "main.d." + suffix + ".ts"
	layout := ""
	if parts[1] == "relocated" {
		layout = ".vibe/declarations"
		sidecar = layout + "/" + sidecar
	}
	scalar := []string{"7", `"value"`}[(variant>>3)&1]
	body := "module parse { export interface Shape { readonly value: " + scalar + " }; export const value: " + scalar + " = " + scalar + "; /** @throws {never} */\nexport function make(): Shape { return {value: " + scalar + "} } }\n"
	consumer := ""
	switch parts[0] {
	case "reexport":
		body += "export {value} from parse\nexport type {Shape} from parse\n"
		consumer = "import {value} from %q; import type {Shape} from %q; const checked: " + scalar + " = value; const shape: Shape = {value: " + scalar + "};\n"
	case "alias":
		body += "import type {Shape} from parse\nexport type Public = Shape\nexport {value} from parse\n"
		consumer = "import {value} from %q; import type {Public} from %q; const checked: " + scalar + " = value; const shape: Public = {value: " + scalar + "};\n"
	case "star":
		body += "export * from parse\n"
		consumer = "import {value} from %q; import type {Shape} from %q; const checked: " + scalar + " = value; const shape: Shape = {value: " + scalar + "};\n"
	case "inferred":
		body += "import {make} from parse\nexport const made = make()\n"
		consumer = "import {made} from %q; type Shape = typeof import(%q).made; const checked: " + scalar + " = made.value; const shape: Shape = {value: " + scalar + "};\n"
	}
	config, err := json.Marshal(map[string]any{
		"compilerOptions": map[string]any{"target": "ES2022", "module": "ESNext", "moduleResolution": "Bundler", "strict": true, "skipLibCheck": false, "types": []string{}, "jsx": "preserve", "declaration": true, "noEmit": variant&4 != 0, "rootDir": ".", "outDir": "out"},
		"vibe":            map[string]any{"effectGlobals": false, "effectModules": false, "sidecarDir": layout},
		"files":           []string{name},
	})
	if err != nil {
		t.Fatal(err)
	}
	r, err := w.Compile(t.Context(), Project{Files: map[string]string{name: body, "package.json": `{"type":"module"}`}, Config: string(config)})
	if err != nil {
		t.Fatal(err)
	}
	defer r.Remove()
	gapKey := fmt.Sprintf("%s/%s/nested%t/noemit%t/scalar%d", key, suffix, variant&2 != 0, variant&4 != 0, (variant>>3)&1)
	if HasError(r.Diagnostics) || r.Program == nil {
		Gap(t, moduleSidecarResolutionTarget, "compile:"+gapKey, "valid VIP-40 producer rejected: %v\n%s", r.Diagnostics, body)
		return
	}
	declarations := map[string]string{}
	for name, text := range r.Outputs {
		if strings.HasSuffix(name, ".d.ts") {
			declarations[name] = text
		}
	}
	emitted := r.Program.EmitDeclarationSidecars(t.Context(), func(name, text string) error {
		relative, err := filepath.Rel(r.Dir, name)
		if err != nil {
			return err
		}
		declarations[filepath.ToSlash(relative)] = text
		return nil
	})
	if emitted == nil || emitted.EmitSkipped || HasError(emitted.Diagnostics) || declarations[sidecar] == "" {
		Gap(t, moduleSidecarResolutionTarget, "emit:"+gapKey, "missing sidecar %s: result=%+v outputs=%v", sidecar, emitted, declarations)
		return
	}
	dir := t.TempDir()
	for name, text := range declarations {
		moduleSidecarWrite(t, dir, name, text)
	}
	importPath := "./" + strings.TrimSuffix(sidecar, ".d."+suffix+".ts") + "." + suffix
	value := "value"
	if parts[0] == "inferred" {
		value = "made.value"
	}
	consumer += "// @ts-expect-error emitted literal must reject false, including an accidental any\nconst wrong: false = " + value + "\n"
	moduleSidecarWrite(t, dir, "consumer.ts", fmt.Sprintf(consumer, importPath, importPath))
	output, err := moduleSidecarStockCheck(t, stock, dir)
	if err != nil {
		Gap(t, moduleSidecarResolutionTarget, gapKey, "VIP-27 %q; independent stock consumer must resolve only emitted declarations: %v\n%s\nsidecar:\n%s", moduleSidecarResolutionQuotes[1], err, output, declarations[sidecar])
	}
	ExpectPending(t, moduleSidecarResolutionTarget, "compile:"+gapKey)
	ExpectPending(t, moduleSidecarResolutionTarget, "emit:"+gapKey)
	ExpectPending(t, moduleSidecarResolutionTarget, gapKey)
	ExpectPending(t, moduleSidecarResolutionTarget, specCorpusKey(t))
}

func TestModuleSidecarResolutionQuoted(t *testing.T) { moduleSidecarResolutionQuoted(t) }

func FuzzModuleSidecarResolution(f *testing.F) {
	startShortBudget(f)
	moduleSidecarResolutionQuoted(f)
	w, stock := NewWorkspace(f), StockTypeScript(f)
	for i, key := range moduleSidecarResolutionKeys {
		f.Add(key, uint8(i))
	}
	f.Fuzz(func(t *testing.T, key string, variant uint8) {
		checkModuleSidecarResolution(t, w, stock, moduleSidecarResolutionKey(key, variant), variant)
	})
}

func TestModuleSidecarResolution(t *testing.T) {
	TestModuleSidecarResolutionQuoted(t)
	w, stock := NewWorkspace(t), StockTypeScript(t)
	for _, key := range moduleSidecarResolutionKeys {
		for _, variant := range []uint8{0, 7, 8, 15} {
			t.Run(fmt.Sprintf("%s/%d", key, variant), func(t *testing.T) { checkModuleSidecarResolution(t, w, stock, key, variant) })
		}
	}
}

func TestModuleSidecarStockOracle(t *testing.T) {
	stock := StockTypeScript(t)
	for _, suffix := range []string{"vibe", "vibex"} {
		for _, relocated := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/%t", suffix, relocated), func(t *testing.T) {
				dir := t.TempDir()
				prefix := ""
				if relocated {
					prefix = ".vibe/declarations/src/"
				}
				moduleSidecarWrite(t, dir, prefix+"main.d."+suffix+".ts", "export {value} from './main."+suffix+".parse.js'\n")
				body := prefix + "main." + suffix + ".parse.d.ts"
				moduleSidecarWrite(t, dir, body, "export declare const value: 7\n")
				moduleSidecarWrite(t, dir, "consumer.ts", fmt.Sprintf("import {value} from %q; const checked: 7 = value\n", "./"+prefix+"main."+suffix))
				if out, err := moduleSidecarStockCheck(t, stock, dir); err != nil {
					t.Fatalf("valid native declaration control: %v\n%s", err, out)
				}
				if err := os.Remove(filepath.Join(dir, body)); err != nil {
					t.Fatal(err)
				}
				if out, err := moduleSidecarStockCheck(t, stock, dir); err == nil || !strings.Contains(out, "TS2307") {
					t.Fatalf("missing body declaration must fail with TS2307: %v\n%s", err, out)
				}
			})
		}
	}
}
