package vibelangfuzz

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/effecttsgo/lint"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

const lintDefectBridgeQuote = "Generated synchronous defect bridges use `Effect.orDie(Effect.try({ try: () => call(), catch: (e) => e }))`."

func TestLintDefectBridgeQuoted(t *testing.T) {
	for chapter, quote := range map[string]string{
		"007-tooling.md":       lintDefectBridgeQuote,
		"../vips/0023-pipe.md": nativePipeLintQuote,
	} {
		if !strings.Contains(SpecText(chapter), quote) {
			t.Fatalf("%s no longer says %q", chapter, quote)
		}
	}
}

type lintDefectBridgeRow struct {
	Key        string `json:"key"`
	Expression string `json:"expression"`
	Count      int    `json:"count"`
}

func lintDefectBridgeRows(t testing.TB) []lintDefectBridgeRow {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(Root(), "typescript/tsc/internal/vibelangfuzz/testdata/corpus/alchemy-piped-defect-bridge.json"))
	if err != nil {
		t.Fatal(err)
	}
	var rows []lintDefectBridgeRow
	if err := json.Unmarshal(data, &rows); err != nil {
		t.Fatal(err)
	}
	return rows
}

func checkLintDefectBridge(t *testing.T, w *Workspace, row lintDefectBridgeRow, variant byte) {
	t.Helper()
	header := ""
	switch variant % 3 {
	case 1:
		header = "import { Effect } from \"effect\"\n"
	case 2:
		header = "import * as Effect from \"effect/Effect\"\n"
	}
	mapping := "(cause) => cause"
	if variant&4 != 0 {
		mapping = "(cause) => { return cause }"
	}
	if variant&32 != 0 {
		mapping = "(cause): any => cause"
	}
	program := "Effect.try({ try: () => predicate(value) ? value : undefined, catch: " + mapping + " })"
	if variant&64 != 0 {
		program = "Effect.tryPromise({ try: async () => predicate(value) ? value : undefined, catch: " + mapping + " })"
	}
	source := header + "import { predicate } from \"./foreign.js\"\n" +
		"const unrelated = { orDie: (self: Effect.Effect<unknown, unknown>) => self, catch: (self: Effect.Effect<unknown, unknown>, handler: unknown) => self }\n" +
		"export effect function probe(value: unknown) { return try (" +
		strings.ReplaceAll(row.Expression, "PROGRAM", program) + ") }\n"
	corpus := filepath.Join(Root(), "typescript/tsc/internal/vibelangfuzz/testdata/lint-defect-bridge")
	foreign, err := os.ReadFile(filepath.Join(corpus, "foreign.ts"))
	if err != nil {
		t.Fatal(err)
	}
	if row.Key == "alchemy-pipe" && variant == 0 {
		witness, err := os.ReadFile(filepath.Join(corpus, "alchemy-piped-defect-bridge.vibe"))
		if err != nil {
			t.Fatal(err)
		}
		source = string(witness)
	}
	if variant&8 != 0 {
		source = strings.ReplaceAll(source, "\n", "\r\n")
	}
	severity := "error"
	if variant&16 != 0 {
		severity = "warning"
	}
	// This interim diagnostic keeps its supported legacy severity map.
	cfg := fmt.Sprintf(`{"compilerOptions":{"target":"es2022","module":"nodenext","moduleResolution":"nodenext","strict":true,"skipLibCheck":true,"types":[],"noEmit":true},"vibelang":{"diagnostics":{"EK4806":%q}},"files":["main.vibe","foreign.ts"]}`, severity)
	// Go may place temporary projects under an ignored build-cache directory.
	// This rule fixture has its own repository boundary for CLI discovery.
	dir, err := w.writeProject(Project{Files: map[string]string{
		".jj":          "",
		"package.json": servicesPackage, "main.vibe": source,
		"foreign.ts": string(foreign),
	}, Config: cfg})
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(dir)
	c := w.programIn(dir, true)
	if c.Program == nil {
		t.Fatal("missing program")
	}
	ds := append(c.Program.GetSyntacticDiagnostics(t.Context(), nil), c.Program.GetSemanticDiagnostics(t.Context(), nil)...)
	count := 0
	for _, d := range ds {
		if d.Code() == 4806 {
			count++
		} else if d.Category() == diagnostics.CategoryError {
			t.Fatalf("invalid witness: %s\n%s", d.String(), source)
		}
	}
	if count != row.Count {
		Gap(t, "FuzzLintDefectBridge", row.Key, "VIP-23: %s; chapter 007: %s; EK4806=%d want=%d variant=%d\n%s", nativePipeLintQuote, lintDefectBridgeQuote, count, row.Count, variant, source)
	}
	sys := &sidecarParitySystem{fs: w.fs, cwd: tspath.RootedDirectoryPathFromAbsolute(dir)}
	status := lint.Command(t.Context(), sys, []string{"-p", filepath.Join(dir, "tsconfig.json")})
	output := sys.output.String()
	wantStatus := 0
	if row.Count > 0 && severity == "error" {
		wantStatus = 1
	}
	if strings.Count(output, " EK4806:") != row.Count || status != wantStatus {
		Gap(t, "FuzzLintDefectBridge", row.Key, "lint count/status differs: want=%d/%d got status=%d variant=%d\n%s", row.Count, wantStatus, status, variant, output)
	}
	ExpectPending(t, "FuzzLintDefectBridge", row.Key)
}

func TestLintDefectBridge(t *testing.T) {
	w := NewWorkspace(t)
	for _, row := range lintDefectBridgeRows(t) {
		for _, variant := range []byte{0, 1, 2, 64} {
			t.Run(fmt.Sprintf("%s/%d", row.Key, variant), func(t *testing.T) { checkLintDefectBridge(t, w, row, variant) })
		}
	}
}

func FuzzLintDefectBridge(f *testing.F) {
	startShortBudget(f)
	rows := lintDefectBridgeRows(f)
	for _, row := range rows {
		f.Add(row.Key, byte(0))
	}
	for _, variant := range []byte{1, 2, 4, 8, 16, 31, 32, 64, 127} {
		f.Add("alchemy-pipe", variant)
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, variant byte) {
		TestLintDefectBridgeQuoted(t)
		index := slices.IndexFunc(rows, func(row lintDefectBridgeRow) bool { return row.Key == key })
		if index < 0 {
			index = int(variant) % len(rows)
		}
		checkLintDefectBridge(t, w, rows[index], variant)
	})
}
