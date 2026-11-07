package vibelangfuzz

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/effecttsgo/lint"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

const lintVoidTwinQuote = "They run on selected `.ts` and `.vibe` inputs, keeping the pinned upstream rule/file eligibility and declaration/library exclusions."

func TestLintVoidSuccessTwinsQuoted(t *testing.T) {
	if !strings.Contains(SpecText("007-tooling.md"), lintVoidTwinQuote) {
		t.Fatalf("chapter 007 no longer says %q", lintVoidTwinQuote)
	}
}

type lintVoidTwin struct {
	Key   string `json:"key"`
	TS    string `json:"ts"`
	Vibe  string `json:"vibe"`
	Count int    `json:"count"`
}

func FuzzLintVoidSuccessTwins(f *testing.F) {
	startShortBudget(f)
	data, err := os.ReadFile(filepath.Join(Root(), "typescript/tsc/internal/vibelangfuzz/testdata/corpus/alchemy-effect-in-void-success-twins.json"))
	if err != nil {
		f.Fatal(err)
	}
	var rows []lintVoidTwin
	if err := json.Unmarshal(data, &rows); err != nil {
		f.Fatal(err)
	}
	for _, row := range rows {
		f.Add(row.Key, byte(0))
	}
	f.Add("alchemy-stream-collect", byte(31))
	f.Add("nested-void-variable", byte(31))
	f.Add("nested-void-return", byte(5))
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, variant byte) {
		TestLintVoidSuccessTwinsQuoted(t)
		index := slices.IndexFunc(rows, func(r lintVoidTwin) bool { return r.Key == key })
		if index < 0 {
			index = int(variant) % len(rows)
			key = rows[index].Key
		}
		row := rows[index]
		if row.Vibe == "" {
			row.Vibe = row.TS
		}
		severity := "error"
		if variant&1 != 0 {
			severity = "warning"
		}
		if variant&2 != 0 {
			severity = "off"
		}
		severities := map[string]string{}
		for _, name := range core.VibeImportedLintCodes {
			severities[name] = "off"
		}
		severities["effectInVoidSuccess"] = severity
		cfg, err := json.Marshal(map[string]any{
			"compilerOptions": map[string]any{"target": "es2022", "module": "nodenext", "moduleResolution": "nodenext", "strict": true, "skipLibCheck": true, "types": []string{}, "noEmit": true,
				"plugins": []any{map[string]any{"name": "@effect/language-service", "diagnosticSeverity": severities}}},
			"files": []string{"ts/twin.ts", "vibe/twin.vibe"},
		})
		if err != nil {
			t.Fatal(err)
		}
		header := "import { Effect, Stream } from \"effect\"\n"
		mutate := func(body string) string {
			if variant&4 != 0 {
				body = strings.ReplaceAll(body, "Effect.succeed(1)", "(Effect.succeed(42))")
			}
			if variant&8 != 0 {
				body = "// retained Alchemy reduction\n" + body
			}
			if variant&16 != 0 {
				body = strings.ReplaceAll(body, "\n", "\r\n")
			}
			return header + body + "\n"
		}
		dir, err := w.writeProject(Project{Files: map[string]string{"package.json": servicesPackage, "ts/twin.ts": mutate(row.TS), "vibe/twin.vibe": mutate(row.Vibe)}, Config: string(cfg)})
		if err != nil {
			t.Fatal(err)
		}
		defer os.RemoveAll(dir)
		c := w.programIn(dir, true)
		if c.Program == nil {
			t.Fatal("twin program unavailable")
		}
		ds := append(c.Diagnostics, c.Program.GetSemanticDiagnostics(t.Context(), nil)...)
		counts := map[string]int{}
		var tsSites, vibeSites []string
		for _, d := range ds {
			if d.Code() == 2307 || d.Code() == 3006 || d.Code() == 3007 {
				t.Fatalf("invalid twin setup: %s", d.MessageText())
			}
			if d.Source() != "EK" || d.Code() != 3830 {
				continue
			}
			name := filepath.Base(string(d.File().FileName()))
			counts[name]++
			cat := diagnostics.CategoryError
			if severity == "warning" {
				cat = diagnostics.CategoryWarning
			}
			if d.Category() != cat {
				Gap(t, "FuzzLintVoidSuccessTwins", key, "wrong category %v for %s", d.Category(), severity)
			}
			site := fmt.Sprintf("%d:%d", d.Pos(), d.End())
			if name == "twin.ts" {
				tsSites = append(tsSites, site)
			} else {
				vibeSites = append(vibeSites, site)
			}
		}
		want := row.Count
		if severity == "off" {
			want = 0
		}
		if counts["twin.ts"] != want || counts["twin.vibe"] != want {
			Gap(t, "FuzzLintVoidSuccessTwins", key, "VIP-38: %s; TypeScript=%d VibeLang=%d expected=%d severity=%s", lintVoidTwinQuote, counts["twin.ts"], counts["twin.vibe"], want, severity)
		}
		if row.TS == row.Vibe && !slices.Equal(tsSites, vibeSites) {
			Gap(t, "FuzzLintVoidSuccessTwins", key, "written twin diagnostic spans differ: %v / %v", tsSites, vibeSites)
		}
		// Run the actual lint command with VibeLang's checker hooks registered.
		// Its compiler project selects the same pinned rule as the TypeScript oracle.
		// The lint package's own unit tests cannot register VibeLang (an import
		// cycle), so this additionally checks that EK4802 is never promoted.
		var lintConfig map[string]any
		if err := json.Unmarshal(cfg, &lintConfig); err != nil {
			t.Fatal(err)
		}
		lintConfig["files"] = []string{"vibe/twin.vibe"}
		lintJSON, err := json.Marshal(lintConfig)
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, "lint-config.json"), lintJSON, 0644); err != nil {
			t.Fatal(err)
		}
		sys := &sidecarParitySystem{fs: w.fs, cwd: tspath.RootedDirectoryPathFromAbsolute(dir)}
		status := lint.Command(t.Context(), sys, []string{"-p", filepath.Join(dir, "lint-config.json")})
		output := sys.output.String()
		cliCount := strings.Count(output, " EK3830:")
		if cliCount != want || strings.Contains(output, "error EK4802:") {
			Gap(t, "FuzzLintVoidSuccessTwins", key, "lint command differs from pinned TypeScript rule (want %d): status=%d\n%s", want, status, output)
		}
		wantStatus := 0
		if want > 0 && severity == "error" {
			wantStatus = 1
		}
		if status != wantStatus {
			Gap(t, "FuzzLintVoidSuccessTwins", key, "lint status=%d want=%d\n%s", status, wantStatus, output)
		}
		ExpectPending(t, "FuzzLintVoidSuccessTwins", key)
	})
}
