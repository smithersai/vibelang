package vibelangfuzz

import (
	"os"
	"path/filepath"
	"testing"
)

func FuzzRecursiveDeclarationParity(f *testing.F) {
	startShortBudget(f)
	recursiveDeclarationsChapter(f)
	w := NewWorkspace(f)
	tsc := StockTypeScript(f)
	for _, shape := range recursiveShapes {
		f.Add([]byte("recursive:" + shape.name + "/1/exported"))
		f.Add([]byte("recursive:" + shape.name + "/2/local"))
	}
	for _, depth := range []string{"0", "3"} {
		for _, scope := range []string{"exported", "local"} {
			f.Add([]byte("recursive:reverse/" + depth + "/" + scope))
		}
	}
	f.Add([]byte("recursive:reverse/1/local"))
	f.Add([]byte("recursive:reverse/2/exported"))
	f.Add([]byte("iterator"))
	f.Add([]byte("mixed"))
	f.Fuzz(func(t *testing.T, data []byte) {
		recursiveDeclarationsChapter(t)
		source := parseRecursive(data).source()
		files := map[string]string{"main.ts": source, "package.json": `{"type":"module"}`, "tsconfig.json": recursiveConfig}
		if string(data) == "iterator" {
			raw, err := os.ReadFile(filepath.Join(Root(), "typescript/vibelang/cases/cov2-004a-finish-prefix/typescript/native.ts"))
			if err != nil {
				t.Fatal(err)
			}
			files["main.ts"] = string(raw)
		}
		if string(data) == "mixed" {
			files["other.ts"] = "export const wrong: number = 'no'\n"
		}
		CheckParity(t, w, tsc, "FuzzRecursiveDeclarationParity", Archive(files))
	})
}

// rule-evidence: docs/design/vips/0027-declaration-output.md#amendment-cyclic-inferred-declaration-types-2026-11-01 | Other `TS5088` checks and ordinary recursive-inference errors `TS7022`, `TS7023` and `TS7024` remain unchanged.
// retained-5088 and lost-native-error keep every other TS5088 and native error.
func TestCycleBaselineControls(t *testing.T) {
	cycle := stockSpan{File: "main.ts", Start: 16, End: 20, Code: 5088, Category: "error"}
	native := stockSpan{File: "other.ts", Start: 13, End: 18, Code: 2322, Category: "error"}
	declaration := "export declare function make(): {next(): /*elided*/ any};"
	for _, name := range []string{"approved", "changed-type", "missing-elision", "unrelated-source", "retained-5088", "lost-native-error", "changed-map", "changed-javascript"} {
		t.Run(name, func(t *testing.T) {
			stock := []stockSpan{cycle, native}
			baseline := []stockSpan{native}
			emitted := map[string]string{"out/main.d.ts": declaration, "out/main.d.ts.map": "map", "out/main.js": "native JS"}
			written := map[string]string{"out/main.js": "native JS"}
			fallback := map[string]string{"out/main.d.ts": declaration, "out/main.d.ts.map": "map", "out/main.js": "native JS"}
			from := map[string]string{"out/main.d.ts": "main.ts"}
			switch name {
			case "changed-type":
				fallback["out/main.d.ts"] += "export declare const extra: number;"
			case "missing-elision":
				emitted["out/main.d.ts"] = "export declare function make(): any;"
				fallback["out/main.d.ts"] = emitted["out/main.d.ts"]
			case "unrelated-source":
				from["out/main.d.ts"] = "other.ts"
			case "retained-5088":
				baseline = append(baseline, cycle)
			case "lost-native-error":
				baseline = nil
			case "changed-map":
				fallback["out/main.d.ts.map"] = "changed"
			case "changed-javascript":
				written["out/main.js"] = "different native JS"
			}
			filtered, outputs, ok := cycleParityExpectation(stock, baseline, emitted, written, fallback, from, false)
			if name == "approved" {
				if !ok || len(filtered) != 1 || filtered[0] != native || outputs["out/main.d.ts"] != declaration {
					t.Fatal("approved cycle or unrelated native diagnostic lost")
				}
			} else if name == "changed-javascript" {
				if !ok || outputs["out/main.js"] != "different native JS" {
					t.Fatal("the cycle exception replaced native JavaScript")
				}
			} else if ok {
				t.Fatalf("%s acquired an anonymous-cycle exception", name)
			}
		})
	}
}
