package vibelangfuzz

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

// VIP-27, VIP-39 and decided detail285: module view follows the final path.
// This checks checker identity/source selection. Input-overwrite protection
// and relocated sidecar output remain separate owner contracts.
func TestSidecarResolvedPathViewQuoted(t *testing.T) {
	quote := "A non-relative import reaching a known compatibility declaration uses its available mapped source only when TypeScript's final resolved path is outside `node_modules`."
	if !strings.Contains(SpecText("007-tooling.md"), quote) {
		t.Fatalf("Chapter7 no longer says %q", quote)
	}
	vip := SpecText("../vips/0039-vibex.md")
	quote = "A " + sidecarViewBacktick + ".vibex" + sidecarViewBacktick + " file is a " + sidecarViewBacktick + ".vibe" + sidecarViewBacktick + " file read with TypeScript's JSX language variant."
	if !strings.Contains(vip, quote) {
		t.Fatalf("VIP39 no longer says %q", quote)
	}
}

const sidecarViewBacktick = "\x60"

type sidecarViewCase struct {
	key, suffix, route  string
	preserve, published bool
}

func sidecarViewCases() []sidecarViewCase {
	var rows []sidecarViewCase
	for _, suffix := range []string{"vibe", "vibex"} {
		for _, route := range []string{"package", "paths", "imports"} {
			for _, preserve := range []bool{false, true} {
				for _, published := range []bool{false, true} {
					if route == "imports" && published {
						continue
					} // Node forbids node_modules in an imports target.
					pathKind, layout := "real", "workspace"
					if preserve {
						pathKind = "logical"
					}
					if published {
						layout = "published"
					}
					rows = append(rows, sidecarViewCase{key: suffix + "-" + route + "-" + pathKind + "-" + layout, suffix: suffix, route: route, preserve: preserve, published: published})
				}
			}
		}
	}
	return rows
}

// Chapter 007 / package, paths and imports source views follow final real or logical path: docs/design/src/007-tooling.md#53fcdcf637e8582a
// Chapter 007 / package, paths and imports source views follow final real or logical path: docs/design/src/007-tooling.md#af882888697e3917
// Chapter 007 / package, paths and imports source views follow final real or logical path: docs/design/src/007-tooling.md#e07f023638e0a6e3
func FuzzSidecarResolvedPathView(f *testing.F) {
	startShortBudget(f)
	const target = "FuzzSidecarResolvedPathView"
	rows := sidecarViewCases()
	w := NewWorkspace(f)
	imports := map[string]string{}
	mustWrite := func(path, text string) {
		f.Helper()
		if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
			f.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(text), 0600); err != nil {
			f.Fatal(err)
		}
	}
	// installPackages creates our own node_modules directory, linking individual
	// dependencies into it. These fixtures never write into the shared install.
	for _, row := range rows {
		pkg := "view-" + row.key
		relative := "sidecar-view-fixtures/" + row.key + "/lib"
		if row.published {
			relative = "node_modules/" + pkg
		}
		lib := filepath.Join(w.Dir, filepath.FromSlash(relative))
		mustWrite(filepath.Join(lib, "src", "Stage."+row.suffix), "export class Stage { private brand = 1; readonly value = 1; }\n")
		mustWrite(filepath.Join(lib, "src", "Stage.d."+row.suffix+".ts"), "export declare class Stage { private brand; readonly value = 1; }\n")
		manifest := sidecarViewManifest(pkg, "./src/Stage.d."+row.suffix+".ts", "./src/Stage.js")
		mustWrite(filepath.Join(lib, "package.json"), manifest)
		if !row.published {
			if err := os.Symlink(filepath.Join("..", filepath.FromSlash(relative)), filepath.Join(w.Dir, "node_modules", pkg)); err != nil {
				f.Fatal(err)
			}
		}
		if row.route == "imports" {
			imports["#stage-"+row.key] = "./" + relative + "/src/Stage.d." + row.suffix + ".ts"
		}
		f.Add(row.key)
	}
	rootManifest, _ := json.Marshal(map[string]any{"type": "module", "imports": imports})
	mustWrite(filepath.Join(w.Dir, "package.json"), string(rootManifest))
	f.Fuzz(func(t *testing.T, key string) {
		TestSidecarResolvedPathViewQuoted(t)
		index := slices.IndexFunc(rows, func(row sidecarViewCase) bool { return row.key == key })
		if index < 0 {
			if len(key) == 0 {
				return
			}
			index = int(key[0]) % len(rows)
		}
		row := rows[index]
		pkg := "view-" + row.key
		relative := "sidecar-view-fixtures/" + row.key + "/lib"
		if row.published {
			relative = "node_modules/" + pkg
		}
		direct := "../" + relative + "/src/Stage." + row.suffix
		spec := pkg + "/Stage"
		options := map[string]any{
			"target": "ES2022", "module": "NodeNext", "moduleResolution": "NodeNext", "strict": true,
			"skipLibCheck": true, "jsx": "preserve", "noEmit": true, "rootDir": w.Dir,
			"preserveSymlinks": row.preserve, "types": []string{},
		}
		switch row.route {
		case "paths":
			spec = "stage-alias"
			options["paths"] = map[string][]string{spec: {filepath.Join(w.Dir, filepath.FromSlash(relative), "src", "Stage.d."+row.suffix+".ts")}}
		case "imports":
			spec = "#stage-" + row.key
		}
		compile := func(file, source string) *Result {
			config, _ := json.Marshal(map[string]any{"compilerOptions": options, "files": []string{file}})
			var result *Result
			var err error
			within(t, "check final sidecar module view", func() {
				result, err = w.Compile(t.Context(), Project{Files: map[string]string{file: source}, Config: string(config)})
			})
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(result.Remove)
			if result.Program == nil {
				t.Fatalf("no program for %s: %v", row.key, SortedKeys(Keys(result.Dir, result.Diagnostics)))
			}
			return result
		}
		distinct := row.published || row.route == "package" && row.preserve
		control := "class Stage {private brand=1}; const DirectStage=Stage; export const value:Stage=new DirectStage();"
		if distinct {
			control = "class Stage {private brand=1}; class DirectStage {private brand=1}; export const value:Stage=new DirectStage();"
		}
		native := compile("main.ts", control)
		var want []string
		if distinct {
			want = []string{"TS2322"}
		}
		if !slices.Equal(sidecarViewErrorCodes(native), want) {
			t.Fatalf("invalid nominal TypeScript control: %v", SortedKeys(Keys(native.Dir, native.Diagnostics)))
		}
		source := fmt.Sprintf("import {Stage} from %q;\nimport {Stage as DirectStage} from %q;\nexport const value:Stage=new DirectStage();\n", spec, direct)
		result := compile("main.vibe", source)
		gaps := &Gaps{Target: target, Input: source}
		// Equality alone could pass if both imports incorrectly chose the sidecar.
		// The explicit Vibe import must actually load its known source too.
		if !slices.Equal(sidecarViewErrorCodes(result), want) || result.SourceFile(direct) == nil {
			gaps.Add(row.key, "VIP27/39 final-path module view wants errors=%v and direct source loaded; got %v, source=%t",
				want, SortedKeys(Keys(result.Dir, result.Diagnostics)), result.SourceFile(direct) != nil)
		} else {
			ExpectPending(t, target, row.key)
		}
		gaps.FinishInput(t, specCorpusKey(t))
	})
}

func sidecarViewErrorCodes(result *Result) []string {
	var codes []string
	for _, key := range Keys(result.Dir, result.Diagnostics) {
		if key.Category.Name() == "error" {
			code := key.Code
			// Native TypeScript chooses either nominal-assignment code based
			// on whether the two class names print with the same qualifier.
			if code == 2719 {
				code = 2322
			}
			codes = append(codes, fmt.Sprintf("%s%d", cmp(key.Source, "TS"), code))
		}
	}
	slices.Sort(codes)
	return slices.Compact(codes)
}

// Conditional export order is significant. Marshaling nested maps sorts
// "default" before "types", so a .js default resolves to the available .vibe
// source before the test ever exercises its compatibility declaration.
func sidecarViewManifest(pkg, declaration, runtime string) string {
	return fmt.Sprintf(`{"name":%q,"type":"module","exports":{"./Stage":{"types":%q,"default":%q}}}`, pkg, declaration, runtime)
}

func TestSidecarExportConditionsMatchStock(t *testing.T) {
	stock := StockTypeScript(t)
	for _, typesFirst := range []bool{false, true} {
		for _, preserve := range []bool{false, true} {
			t.Run(fmt.Sprintf("types-first=%t/preserve=%t", typesFirst, preserve), func(t *testing.T) {
				dir := t.TempDir()
				write := func(name, text string) {
					t.Helper()
					path := filepath.Join(dir, filepath.FromSlash(name))
					if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
						t.Fatal(err)
					}
					if err := os.WriteFile(path, []byte(text), 0600); err != nil {
						t.Fatal(err)
					}
				}
				write("package.json", `{"type":"module"}`)
				manifest := sidecarViewManifest("lib", "./src/Stage.d.ts", "./src/Stage.js")
				if !typesFirst {
					manifest = `{"name":"lib","type":"module","exports":{"./Stage":{"default":"./src/Stage.js","types":"./src/Stage.d.ts"}}}`
				}
				write("node_modules/lib/package.json", manifest)
				write("node_modules/lib/src/Stage.ts", "export class Stage { private brand=1; readonly value=1 }")
				write("node_modules/lib/src/Stage.d.ts", "export declare class Stage { private brand; readonly value=1 }")
				write("main.ts", `import {Stage} from "lib/Stage"; import {Stage as DirectStage} from "./node_modules/lib/src/Stage.ts"; export const value:Stage=new DirectStage();`)
				options := map[string]any{"strict": true, "noEmit": true, "skipLibCheck": true, "target": "es2022", "module": "nodenext", "moduleResolution": "nodenext", "allowImportingTsExtensions": true, "preserveSymlinks": preserve, "types": []string{}}
				config, err := json.Marshal(map[string]any{"compilerOptions": options, "files": []string{"main.ts"}})
				if err != nil {
					t.Fatal(err)
				}
				write("tsconfig.json", string(config))
				cmd := exec.CommandContext(t.Context(), stock, "-p", filepath.Join(dir, "tsconfig.json"))
				output, err := cmd.CombinedOutput()
				if typesFirst {
					text := string(output)
					if err == nil || strings.Count(text, "error TS") != 1 || !strings.Contains(text, "TS2322") && !strings.Contains(text, "TS2719") {
						t.Fatalf("types-first exports must retain distinct native class identities: %v\n%s", err, output)
					}
				} else if err != nil {
					t.Fatalf("default-first exports select the native source before types: %v\n%s", err, output)
				}
			})
		}
	}
}
