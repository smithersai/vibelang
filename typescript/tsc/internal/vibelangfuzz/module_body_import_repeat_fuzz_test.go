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

const bodyImportRepeatTarget = "FuzzModuleBodyImportRepeat"

// The ts- keys import the body from a .ts file instead of a declaration, as a
// Smithers test reaches a package's tracked companion.
var bodyImportRepeatKeys = []string{"source-import", "runtime-import", "extensionless", "explicit-declaration", "ts-source-import", "ts-runtime-import"}

func TestModuleBodyImportRepeatQuoted(t *testing.T) { bodyImportRepeatQuoted(t) }
func bodyImportRepeatQuoted(t testing.TB) {
	const twin = "changes no diagnostic, type, emitted statement, declaration or run-time observation."
	const guard = "A declaration explicitly selected in `files` remains an input: an attempted compatibility write over it reports `TS5055`"
	if !strings.Contains(SpecText("../vips/0040-module-declarations.md"), twin) {
		t.Fatalf("VIP-40 no longer says %q", twin)
	}
	if !strings.Contains(SpecText("../vips/0027-declaration-output.md"), guard) {
		t.Fatalf("VIP-27 no longer says %q", guard)
	}
}

// The two projects are the VIP-40 body/sibling twins. A previous declaration
// output must not change which source a declaration import resolves to.
func bodyImportRepeatObserve(t *testing.T, key string, variant uint8, twin bool) []bool {
	t.Helper()
	ext, tsExt := "vibe", "ts"
	if variant&1 != 0 {
		ext, tsExt = "vibex", "tsx"
	}
	name := []string{"platform", "Text", "Ω"}[int(variant>>1)%3]
	prefix := []string{"/case/", "/case/deep/", "/case/pkg.vibe/"}[int(variant>>3)%3]
	part := strings.TrimSuffix(parser.ModuleDeclarationFileSuffix(name), ".ts")
	stem := "main." + ext + part
	suffix := map[string]string{"source-import": "." + tsExt, "runtime-import": ".js", "extensionless": "", "explicit-declaration": ".d.ts", "ts-source-import": "." + tsExt, "ts-runtime-import": ".js"}[key]
	importer, importText := "a.d.ts", "export declare const row: import(\"./"+stem+suffix+"\").Row;\n"
	if strings.HasPrefix(key, "ts-") {
		importer, importText = "use.ts", "import type { Row } from \"./"+stem+suffix+"\"\nexport const row: Row = { value: 7 }\n"
	}
	source := "module " + name + " { export interface Row {readonly value: 7} }\nexport type {Row} from " + name + "\n"
	main := "main." + ext
	files := map[string]any{
		prefix + "package.json": "{\"type\":\"module\"}",
		prefix + importer:       importText,
	}
	if twin {
		main = "main." + tsExt
		source = "export type {Row} from \"./" + stem + ".js\"\n"
		files[prefix+stem+"."+tsExt] = "export interface Row {readonly value: 7}\n"
	}
	files[prefix+main] = source
	if key == "explicit-declaration" {
		files[prefix+stem+".d.ts"] = "export interface Row {readonly value: 7}\n"
	}
	options := map[string]any{"noLib": true, "types": []string{}, "target": "ESNext", "module": "ESNext", "moduleResolution": "Bundler", "noEmit": true, "jsx": "preserve", "allowImportingTsExtensions": true}
	if variant&64 != 0 {
		options["moduleSuffixes"] = []string{"", ".d.vibe"}
	}
	configJSON, _ := json.Marshal(map[string]any{"compilerOptions": options, "vibe": map[string]any{"effectGlobals": false, "effectModules": false}, "files": []string{main, importer}})
	files[prefix+"tsconfig.json"] = string(configJSON)
	blocked := []bool{}
	for round := range 3 {
		fs := bundled.WrapFS(vfstest.FromMap(files, tspath.CaseSensitive))
		config, ds := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromNormalized(prefix+"tsconfig.json"), &core.CompilerOptions{}, nil, fs, nil)
		if len(ds) != 0 || len(config.Errors) != 0 {
			t.Fatalf("config: %v %v", ds, config.Errors)
		}
		p := compiler.NewProgram(compiler.ProgramOptions{Config: config, Host: compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil), SingleThreaded: core.BoolToTristate(variant&128 == 0)})
		hit := false
		for _, d := range p.GetProgramDiagnostics() {
			if d.Code() == 5055 {
				hit = true
			} else {
				t.Fatalf("round %d: %s", round, d.String())
			}
		}
		blocked = append(blocked, hit)
		result := p.EmitDeclarationSidecars(t.Context(), func(name, text string) error { files[name] = text; return nil })
		if result != nil && len(result.Diagnostics) > 0 {
			t.Fatalf("round %d emit: %+v", round, result.Diagnostics)
		}
	}
	return blocked
}

func FuzzModuleBodyImportRepeat(f *testing.F) {
	startShortBudget(f)
	bodyImportRepeatQuoted(f)
	for i, key := range bodyImportRepeatKeys {
		f.Add(key, uint8(i*65))
	}
	f.Fuzz(func(t *testing.T, key string, variant uint8) {
		if !slices.Contains(bodyImportRepeatKeys, key) {
			key = bodyImportRepeatKeys[int(variant)%len(bodyImportRepeatKeys)]
		}
		got := bodyImportRepeatObserve(t, key, variant, false)
		want := bodyImportRepeatObserve(t, key, variant, true)
		if key == "explicit-declaration" {
			want = []bool{true, true, true}
		} // VIP-27 protects the explicit native output input.
		gap := fmt.Sprintf("%s/%d", key, variant)
		if !slices.Equal(got, want) {
			Gap(t, bodyImportRepeatTarget, gap, "VIP-40 repeated body/sibling input identity: body=%v sibling=%v", got, want)
		}
		ExpectPending(t, bodyImportRepeatTarget, gap)
		ExpectPending(t, bodyImportRepeatTarget, specCorpusKey(t))
	})
}
