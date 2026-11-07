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
)

const nativePipeLintQuote = "Its Effect TS is nested calls, with each topic evaluated once into a temporary:"
const nativePipeLintTarget = "FuzzLintNativePipeStages"

var nativePipeLintKeys = []string{"native-concise", "native-block", "written-chain", "written-flat", "written-inside-native"}

func TestLintNativePipeStagesQuoted(t *testing.T) {
	if !strings.Contains(SpecText("../vips/0023-pipe.md"), nativePipeLintQuote) {
		t.Fatalf("VIP-23 no longer says %q", nativePipeLintQuote)
	}
}

func nativePipeLintSources(key string, variant byte) (ts, vibe string, want int) {
	var stages, native []string
	for i := 0; i < 2+int(variant%3); i++ {
		stage := fmt.Sprintf("Stream.map((x: number) => x + %d)", i+1)
		stages = append(stages, stage)
		native = append(native, stage+"(%)")
	}
	flat := "s.pipe(" + strings.Join(stages, ", ") + ")"
	chain := "s.pipe(" + strings.Join(stages[:len(stages)-1], ", ") + ").pipe(" + stages[len(stages)-1] + ")"
	pipeline := "s |> " + strings.Join(native, " |> ") + " |> Stream.runCollect(%)"
	if key == "written-chain" || key == "written-inside-native" {
		want = 1
	}
	switch key {
	case "written-chain":
		ts = "export const probe = (s: Stream.Stream<number>) => " + chain
		vibe = ts
	case "written-flat":
		ts = "export const probe = (s: Stream.Stream<number>) => " + flat
		vibe = ts
	default:
		ts = "export const probe = (s: Stream.Stream<number>) => Stream.runCollect(" + flat + ")"
		if key == "written-inside-native" {
			pipeline = "(" + chain + ") |> Stream.runCollect(%)"
			ts = "export const probe = (s: Stream.Stream<number>) => Stream.runCollect(" + chain + ")"
		}
		expression := "try (" + pipeline + ")"
		if variant&4 != 0 {
			expression = "Array.from(" + expression + ")"
			ts = "export const probe = (s: Stream.Stream<number>) => Effect.map(Stream.runCollect(" + flat + "), values => Array.from(values))"
			if key == "written-inside-native" {
				ts = strings.Replace(ts, flat, chain, 1)
			}
		}
		if key == "native-block" {
			vibe = "export effect function probe(s: Stream.Stream<number>) { return " + expression + " }"
		} else {
			vibe = "export const probe = effect (s: Stream.Stream<number>) => " + expression
		}
	}
	header := "import { Effect, Stream } from \"effect\"\n"
	if variant&8 != 0 {
		header = "import * as Stream from \"effect/Stream\"\nimport * as Effect from \"effect/Effect\"\n"
	}
	ts = header + ts + "\n"
	vibe = "// @vibelang-diagnostics EK4825:error\n" + header + vibe + "\n"
	if variant&16 != 0 {
		ts = strings.ReplaceAll(ts, "\n", "\r\n")
		vibe = strings.ReplaceAll(vibe, "\n", "\r\n")
	}
	return
}

func FuzzLintNativePipeStages(f *testing.F) {
	startShortBudget(f)
	for _, key := range nativePipeLintKeys {
		f.Add(key, byte(0))
		f.Add(key, byte(31))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, variant byte) {
		TestLintNativePipeStagesQuoted(t)
		if !slices.Contains(nativePipeLintKeys, key) {
			key = nativePipeLintKeys[int(variant)%len(nativePipeLintKeys)]
		}
		ts, vibe, want := nativePipeLintSources(key, variant)
		severities := map[string]string{}
		for _, name := range core.VibeImportedLintCodes {
			severities[name] = "off"
		}
		severities["unnecessaryPipeChain"] = "error"
		cfg, err := json.Marshal(map[string]any{"compilerOptions": map[string]any{
			"target": "es2022", "module": "nodenext", "moduleResolution": "nodenext", "strict": true, "skipLibCheck": true, "types": []string{}, "noEmit": true,
			"plugins": []any{map[string]any{"name": "@effect/language-service", "diagnosticSeverity": severities}},
		}, "files": []string{"ts/twin.ts", "vibe/twin.vibe"}})
		if err != nil {
			t.Fatal(err)
		}
		dir, err := w.writeProject(Project{Files: map[string]string{"package.json": servicesPackage, "ts/twin.ts": ts, "vibe/twin.vibe": vibe}, Config: string(cfg)})
		if err != nil {
			t.Fatal(err)
		}
		defer os.RemoveAll(dir)
		c := w.programIn(dir, true)
		if c.Program == nil {
			t.Fatal("missing program")
		}
		ds := append(c.Program.GetSyntacticDiagnostics(t.Context(), nil), c.Program.GetSemanticDiagnostics(t.Context(), nil)...)
		tsCount, vibeCount := 0, 0
		for _, d := range ds {
			if d.Category() == diagnostics.CategoryError && d.Code() != 4825 && d.Code() != 38127 {
				t.Fatalf("invalid twin: %s", d.String())
			}
			name := filepath.Base(string(d.File().FileName()))
			if name == "twin.ts" && d.Code() == 38127 {
				tsCount++
			}
			if name == "twin.vibe" && (d.Code() == 4825 || d.Code() == 38127) {
				vibeCount++
			}
		}
		if tsCount != want || vibeCount != want {
			Gap(t, nativePipeLintTarget, key, "VIP-23: %s; TypeScript=%d VibeLang=%d expected=%d variant=%d\n%s", nativePipeLintQuote, tsCount, vibeCount, want, variant, vibe)
		}
		ExpectPending(t, nativePipeLintTarget, key)
	})
}
