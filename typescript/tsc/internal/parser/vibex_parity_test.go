package parser_test

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
)

type vibexDiagnostic struct {
	Code   int32 `json:"code"`
	Start  int   `json:"start"`
	Length int   `json:"length"`
}

func vibexDiagnostics(file *ast.SourceFile) []vibexDiagnostic {
	result := []vibexDiagnostic{}
	for _, d := range file.Diagnostics() {
		result = append(result, vibexDiagnostic{d.Code(), d.Pos(), d.Len()})
	}
	return result
}
func vibexTree(file *ast.SourceFile) []string {
	var result []string
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		result = append(result, fmt.Sprintf("%s:%d:%d", n.Kind, n.Pos(), n.End()))
		n.ForEachChild(visit)
		return false
	}
	visit(file.AsNode())
	return result
}

// VIP-39: "Every JSX production, and its scanning, checking and emit, is exactly .tsx's."
// Compare syntax nodes and ranges, excluding the module marker and VibeLang flags:
// VIP-30 deliberately makes every .vibex a module.
func TestVibexClashParity(t *testing.T) {
	dir := filepath.Join("..", "..", "..", "vibelang", "cases", "vibex-clash")
	files, err := filepath.Glob(filepath.Join(dir, "*.vibex"))
	if err != nil {
		t.Fatal(err)
	}
	if len(files) < 39 {
		t.Fatalf("clash corpus has %d rows, want all 39 VIP-39 rows", len(files))
	}
	controls := map[string][]vibexDiagnostic{}
	for _, path := range files {
		t.Run(filepath.Base(path), func(t *testing.T) {
			source, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			text := string(source)
			got := parseByName("/clash.vibex", text)
			controlPath := strings.TrimSuffix(path, ".vibex") + ".tsx"
			if control, err := os.ReadFile(controlPath); err == nil {
				if string(control) != text {
					t.Fatal(".tsx control must contain identical bytes")
				}
				want := parseByName("/clash.tsx", text)
				if !reflect.DeepEqual(vibexDiagnostics(got), vibexDiagnostics(want)) {
					t.Fatalf("diagnostics differ: vibex=%v tsx=%v", vibexDiagnostics(got), vibexDiagnostics(want))
				}
				if !reflect.DeepEqual(vibexTree(got), vibexTree(want)) {
					t.Fatalf("syntax tree differs:\nvibex=%v\ntsx=%v", vibexTree(got), vibexTree(want))
				}
				controls[filepath.Base(controlPath)] = vibexDiagnostics(want)
			} else {
				if !strings.HasPrefix(text, "// expect: ") {
					t.Fatal("VibeLang row needs an explicit expectation")
				}
				expectation := strings.TrimSpace(strings.Split(text, "\n")[0][len("// expect: "):])
				fields := strings.Fields(expectation)
				switch fields[0] {
				case "valid":
					if ds := got.Diagnostics(); len(ds) != 0 {
						t.Fatalf("valid row rejected: %v", vibexDiagnostics(got))
					}
				case "compiler":
					// Denied syntax may recover in the parser. Its public diagnostic
					// is checked independently by compile-parity.mjs.
					if !strings.Contains(text, "// expect-compile: EK1101") {
						t.Fatal("missing compiler diagnostic expectation")
					}
				case "invalid":
					if len(got.Diagnostics()) == 0 {
						t.Fatal("invalid row accepted")
					}
				default:
					if !strings.HasPrefix(fields[0], "codes=") {
						t.Fatalf("unknown expectation %q", expectation)
					}
					var codes []int32
					for _, code := range strings.Split(strings.TrimPrefix(fields[0], "codes="), ",") {
						n, err := strconv.Atoi(code)
						if err != nil {
							t.Fatal(err)
						}
						codes = append(codes, int32(n))
					}
					actual := []int32{}
					for _, d := range got.Diagnostics() {
						actual = append(actual, d.Code())
					}
					if !reflect.DeepEqual(codes, actual) {
						t.Fatalf("expected recorded diagnostic codes %v, got %v", codes, actual)
					}
				}
				tree := strings.Join(vibexTree(got), "\n")
				for _, kind := range fields[1:] {
					if !strings.Contains(tree, kind+":") {
						t.Errorf("missing node kind %s in %s", kind, tree)
					}
				}
			}
		})
	}
	if len(controls) < 15 {
		t.Fatalf("only %d native controls", len(controls))
	}
	// The stock oracle is checked in so Go package tests remain independent
	// of a Node dependency install. compile-parity.mjs verifies this receipt
	// against live TypeScript 5.9.3 before checking CLI diagnostics.
	data, err := os.ReadFile(filepath.Join(dir, "stock-diagnostics.json"))
	if err != nil {
		t.Fatal(err)
	}
	var stock struct {
		Version  string
		Controls map[string][]vibexDiagnostic
	}
	if err := json.Unmarshal(data, &stock); err != nil {
		t.Fatal(err)
	}
	if stock.Version != "5.9.3" || !reflect.DeepEqual(controls, stock.Controls) {
		t.Fatalf("stock TypeScript %s parser controls differ: fork=%v stock=%v", stock.Version, controls, stock.Controls)
	}
}

// Panel examples remain useful parse/crash witnesses even where a later VIP
// superseded the panel's proposed semantics. Never copy old diagnostics into
// an oracle: only the current numbered spec rows above prescribe outcomes.
func TestVibexPanelCorpus(t *testing.T) {
	data, err := os.ReadFile("../../../vibelang/cases/vibex-clash/panel.json")
	if err != nil {
		t.Fatal(err)
	}
	var rows []struct {
		Key, Source string
		Origins     []string
	}
	if err := json.Unmarshal(data, &rows); err != nil {
		t.Fatal(err)
	}
	groups := map[string]map[string]bool{}
	for _, row := range rows {
		for _, origin := range row.Origins {
			group := strings.SplitN(origin, ":", 2)[0]
			if groups[group] == nil {
				groups[group] = map[string]bool{}
			}
			groups[group][origin] = true
		}
	}
	for group, want := range map[string]int{"sol": 155, "opus": 102, "astra-expanded": 128} {
		if len(groups[group]) < want {
			t.Fatalf("%s panel has %d origins, want at least %d", group, len(groups[group]), want)
		}
	}
	if len(rows) < 300 {
		t.Fatalf("panel corpus incomplete: %d", len(rows))
	}
	for _, row := range rows {
		t.Run(row.Key, func(t *testing.T) {
			first := parseByName("/panel.vibex", row.Source)
			second := parseByName("/panel.vibex", row.Source)
			if !reflect.DeepEqual(vibexDiagnostics(first), vibexDiagnostics(second)) ||
				!reflect.DeepEqual(vibexTree(first), vibexTree(second)) {
				t.Fatal("non-deterministic parse")
			}
		})
	}
}
