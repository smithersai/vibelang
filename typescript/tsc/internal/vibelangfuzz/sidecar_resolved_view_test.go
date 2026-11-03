package vibelangfuzz

import (
	"encoding/json"
	"fmt"
	"os"
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
		manifest, _ := json.Marshal(map[string]any{"name": pkg, "type": "module", "exports": map[string]any{"./Stage": map[string]string{"types": "./src/Stage.d." + row.suffix + ".ts", "default": "./src/Stage.js"}}})
		mustWrite(filepath.Join(lib, "package.json"), string(manifest))
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
			codes = append(codes, fmt.Sprintf("%s%d", cmp(key.Source, "TS"), key.Code))
		}
	}
	slices.Sort(codes)
	return slices.Compact(codes)
}
