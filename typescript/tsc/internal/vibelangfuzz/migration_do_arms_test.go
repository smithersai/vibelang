package vibelangfuzz

import (
	"fmt"
	"os"
	"strings"
	"testing"
)

const migrationDoArmQuote = "Contextual typing reaches only the expression alternatives contributing to the normal result; discarded intermediate expressions and outward returns retain their own source contexts."

func TestMigrationDoArmsQuoted(t *testing.T) {
	data, err := os.ReadFile(SpecPath("002-running.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(data), migrationDoArmQuote) {
		t.Fatalf("Chapter 2 no longer says %q", migrationDoArmQuote)
	}
}

// Foldkit-122: real Option extraction, chart literals and machine selection
// tags. Typed native IIFEs independently express the required result context.
func FuzzMigrationDoArms(f *testing.F) {
	startShortBudget(f)
	keys := []string{"grid", "chart", "machine"}
	for _, key := range keys {
		for context := byte(0); context < 4; context++ {
			for depth := byte(0); depth < 2; depth++ {
				f.Add(key, context, depth)
			}
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, context, depth byte) {
		TestMigrationDoArmsQuoted(t)
		if key != "grid" && key != "chart" && key != "machine" {
			if key == "" {
				return
			}
			key = keys[int(key[0])%len(keys)]
		}
		context %= 4
		depth %= 2
		header, typ, vibe, native, wrongVibe, wrongNative := migrationDoArmProgram(key, depth)
		wrap := func(expr string) string {
			switch context {
			case 0:
				return "export function probe(): " + typ + " { return " + expr + " }\n"
			case 1:
				return "export const probe = (): " + typ + " => " + expr + "\n"
			case 2:
				return "export const probe: { readonly value: " + typ + " } = { value: " + expr + " }\n"
			default:
				return "declare function consume(value: " + typ + "): void\nexport function probe() { consume(" + expr + ") }\n"
			}
		}
		gapKey := fmt.Sprintf("%s:%d:%d", key, context, depth)
		for _, side := range []struct {
			name, file, expr string
			reject           bool
		}{
			{"native", "main.ts", native, false}, {"native-negative", "main.ts", wrongNative, true},
			{"vibe", "main.vibe", vibe, false}, {"vibe-negative", "main.vibe", wrongVibe, true},
		} {
			result, err := w.Compile(t.Context(), Project{Files: map[string]string{side.file: header + wrap(side.expr)}})
			if err != nil {
				t.Fatal(err)
			}
			codes := SortedKeys(Keys(result.Dir, result.Diagnostics))
			failed := HasError(result.Diagnostics)
			result.Remove()
			if side.reject {
				found := false
				for _, diagnostic := range codes {
					if strings.Contains(diagnostic.String(), "TS2322") || strings.Contains(diagnostic.String(), "TS2345") {
						found = true
					}
				}
				if !found {
					t.Fatalf("%s must reject the independent wrong-type control: %v", side.name, codes)
				}
			} else if failed {
				if side.name == "native" {
					t.Fatalf("invalid native completion-context control: %v", codes)
				}
				Gap(t, "FuzzMigrationDoArms", gapKey, "Chapter 2: %s; %s reports %v\n%s", migrationDoArmQuote, side.name, codes, header+wrap(side.expr))
			}
		}
		ExpectPending(t, "FuzzMigrationDoArms", gapKey)
		ExpectPending(t, "FuzzMigrationDoArms", specCorpusKey(t))
	})
}

func migrationDoArmProgram(key string, depth byte) (header, typ, vibe, native, wrongVibe, wrongNative string) {
	switch key {
	case "grid":
		typ = "Grid"
		grid := "number[]"
		if depth&1 != 0 {
			grid = "number[][]"
		}
		header = "import { Option } from \"effect\"\ntype Grid = " + grid + "\ndeclare const input: Option.Option<{ readonly grid: Grid }>\n"
		vibe = "match (input) { when Option.Some(let item): do { const { grid } = item; grid }; when Option.None: do { [] }; }"
		native = "Option.isSome(input) ? ((): Grid => { const { grid } = input.value; return grid })() : []"
		wrongVibe = strings.Replace(vibe, "do { [] }", "do { [\"wrong\"] }", 1)
		wrongNative = strings.Replace(native, ": []", ": [\"wrong\"]", 1)
	case "chart":
		typ = "Chart"
		header = "type Chart = { readonly xAxis: { readonly type: \"category\"; readonly data: string[] } }\ndeclare const flag: boolean\n"
		body := "const extra = {}; ({ ...extra, xAxis: { type: \"category\", data: [] } })"
		if depth&1 != 0 {
			body = "const extra = {}; (do { ({ ...extra, xAxis: { type: \"category\", data: [] } }) })"
		}
		vibe = "match (flag) { when true: do { " + body + " }; default: do { ({ xAxis: { type: \"category\", data: [] } }) }; }"
		native = "flag ? ((): Chart => { const extra = {}; return { ...extra, xAxis: { type: \"category\", data: [] } } })() : { xAxis: { type: \"category\", data: [] } }"
		wrongVibe = strings.ReplaceAll(vibe, "\"category\"", "\"wrong\"")
		wrongNative = strings.ReplaceAll(native, "\"category\"", "\"wrong\"")
	default:
		typ = "Selection"
		header = "type Edge = { readonly condition: boolean; readonly value: number }\ntype Selection = { readonly _tag: \"SelectedEdge\"; readonly edge: Edge } | { readonly _tag: \"IgnoredEdge\" }\ndeclare const input: { readonly edge: Edge }\n"
		body := "const { edge } = input; edge.condition ? { _tag: \"SelectedEdge\", edge } : { _tag: \"IgnoredEdge\" }"
		if depth&1 != 0 {
			body = "const { edge } = input; edge.condition ? ({ _tag: \"SelectedEdge\", edge }) : edge.value > 0 ? { _tag: \"IgnoredEdge\" } : { _tag: \"SelectedEdge\", edge }"
		}
		vibe = "match (input) { when { edge: let item }: do { " + body + " }; }"
		native = "((): Selection => { const { edge } = input; return edge.condition ? { _tag: \"SelectedEdge\", edge } : { _tag: \"IgnoredEdge\" } })()"
		wrongVibe = strings.ReplaceAll(vibe, "\"SelectedEdge\"", "\"MissingEdge\"")
		wrongNative = strings.ReplaceAll(native, "\"SelectedEdge\"", "\"MissingEdge\"")
	}
	return
}
