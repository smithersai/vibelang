package vibelangfuzz

import (
	"encoding/json"
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/vfstest"
)

const privateBodyImportTarget = "FuzzPrivateBodyDeclarationImports"
const privateBodyReaderQuote = "which TypeScript's `allowArbitraryExtensions` resolves, so plain `tsc` and TypeDoc understand `.vibe` imports."

var privateBodyImportKeys = []string{"exact-mask", "pattern-mask", "redirect-mask", "public-namespace"}

func TestPrivateBodyDeclarationImportsQuoted(t *testing.T) {
	if !strings.Contains(SpecText("../vips/0027-declaration-output.md"), privateBodyReaderQuote) {
		t.Fatalf("VIP-27 no longer says %q", privateBodyReaderQuote)
	}
}

func privateBodyDeclarationErrors(t *testing.T, key string, variant uint8) []string {
	t.Helper()
	extension := ".vibe"
	if variant&1 != 0 {
		extension = ".vibex"
	}
	name := []string{"shapes", "platform", "Text", "Ω"}[int(variant>>1)%4]
	stem := "value" + extension + strings.TrimSuffix(parser.ModuleDeclarationFileSuffix(name), ".ts")
	prefix := ""
	if variant&8 != 0 {
		prefix = "types/"
	}
	options := map[string]any{"strict": true, "target": "esnext", "module": "preserve", "moduleResolution": "bundler", "noEmit": true, "allowImportingTsExtensions": true, "allowArbitraryExtensions": true, "jsx": "preserve"}
	vibe := map[string]any{"effectGlobals": false, "effectModules": false, "sidecarDir": strings.TrimSuffix(prefix, "/")}
	config := func(file string) string {
		v, _ := json.Marshal(map[string]any{"compilerOptions": options, "vibe": vibe, "files": []string{file}})
		return string(v)
	}
	exports := `{"./value":{"types":"./` + prefix + `value.d` + extension + `.ts","default":"./value` + extension + `"},"./*":"./*.ts",`
	switch key {
	case "pattern-mask":
		exports += `"./value` + extension + `.*":null}`
	case "redirect-mask":
		exports += fmt.Sprintf("%q:%q}", "./"+stem, "./unrelated.ts")
	default:
		exports += fmt.Sprintf("%q:null}", "./"+stem)
	}
	main := "import {make} from \"provider/value\"; export const value=make();"
	outer := "export {make} from " + name + ";\nexport type {Value} from " + name + ";\n"
	if key == "public-namespace" {
		outer += "export * as Provider from \"./value" + extension + "\";\n"
		main = "import {Provider} from \"provider/value\"; export const value=Provider.make();"
	}
	files := map[string]any{
		"/app/package.json":           `{"type":"module"}`,
		"/app/node_modules/provider":  vfstest.Symlink("/provider"),
		"/app/main" + extension:       main,
		"/app/tsconfig.json":          config("main" + extension),
		"/provider/package.json":      `{"name":"provider","type":"module","exports":` + exports + `}`,
		"/provider/value" + extension: "module " + name + " {\nexport interface Value { readonly count:number }\n/** @throws {never} */ export function make():Value{return {count:1};}\n}\n" + outer,
		"/provider/tsconfig.json":     config("value" + extension),
		"/provider/unrelated.ts":      "export interface Other {readonly different:string}",
	}
	program := func(configName string) *compiler.Program {
		fs := bundled.WrapFS(vfstest.FromMap(files, tspath.CaseSensitive))
		cfg, ds := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromNormalized(configName), &core.CompilerOptions{}, nil, fs, nil)
		if len(ds) != 0 || len(cfg.Errors) != 0 {
			t.Fatalf("config: %v %v", ds, cfg.Errors)
		}
		return compiler.NewProgram(compiler.ProgramOptions{Config: cfg, Host: compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil)})
	}
	errors := []string{}
	for _, cfg := range []string{"/provider/tsconfig.json", "/app/tsconfig.json"} {
		p := program(cfg)
		for _, d := range p.GetSemanticDiagnostics(t.Context(), nil) {
			errors = append(errors, d.String())
		}
		emitted := map[string]string{}
		result := p.EmitDeclarationSidecars(t.Context(), func(name, text string) error { emitted[name] = text; return nil })
		if result == nil || result.EmitSkipped {
			t.Fatalf("sidecar emit: %+v", result)
		}
		for _, d := range result.Diagnostics {
			errors = append(errors, d.String())
		}
		for name, text := range emitted {
			files[name] = text
		}
	}
	delete(files, "/app/main"+extension)
	delete(files, "/provider/value"+extension)
	files["/app/consumer.ts"] = "import {value} from \"./" + prefix + "main" + extension + "\"; export const count:number=value.count;"
	files["/app/tsconfig.json"] = config("consumer.ts")
	for _, d := range program("/app/tsconfig.json").GetSemanticDiagnostics(t.Context(), nil) {
		errors = append(errors, d.String())
	}
	return errors
}

func FuzzPrivateBodyDeclarationImports(f *testing.F) {
	startShortBudget(f)
	for i, key := range privateBodyImportKeys {
		f.Add(key, uint8(i))
		f.Add(key, uint8(i+9))
	}
	f.Fuzz(func(t *testing.T, key string, variant uint8) {
		if !slices.Contains(privateBodyImportKeys, key) {
			key = privateBodyImportKeys[int(variant)%len(privateBodyImportKeys)]
		}
		if !strings.Contains(SpecText("../vips/0027-declaration-output.md"), privateBodyReaderQuote) {
			t.Fatal("missing VIP-27 reader rule")
		}
		gap := fmt.Sprintf("%s/variant=%d", key, variant)
		if errors := privateBodyDeclarationErrors(t, key, variant); len(errors) != 0 {
			Gap(t, privateBodyImportTarget, gap, "VIP-27 declaration reader: %v", errors)
		}
		ExpectPending(t, privateBodyImportTarget, gap)
		ExpectPending(t, privateBodyImportTarget, specCorpusKey(t))
	})
}
