package vibelangfuzz

import (
	"encoding/json"
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"slices"
	"strings"
	"testing"
)

const nativeAwaitClassifierTarget = "FuzzNativeAwaitClassifier"
const nativeAwaitClassifierQuote = "lint warning: `await` on a `Fiber` in an `async` function"
const nativeAwaitDeferredClassifierQuote = "lint warning: `await` on a `Deferred` in an `async` function"

func nativeAwaitClassifierChapter(t testing.TB) {
	if text := SpecText("900-appendices.md"); !strings.Contains(text, nativeAwaitClassifierQuote) || !strings.Contains(text, nativeAwaitDeferredClassifierQuote) {
		t.Fatal("stale native-await classifier quote")
	}
}
func TestNativeAwaitClassifierQuoted(t *testing.T) { nativeAwaitClassifierChapter(t) }
func FuzzNativeAwaitClassifier(f *testing.F) {
	startShortBudget(f)
	nativeAwaitClassifierChapter(f)
	domains := []struct {
		key, typ string
		code     int32
	}{
		{"fiber", "Fiber.Fiber<number>", 4609},
		{"fiber-union", "Fiber.Fiber<number>|Fiber.Fiber<string>", 4609},
		{"fiber-alias", "Task", 4609},
		{"fiber-intersection", "Fiber.Fiber<number>&{extra:1}", 4609},
		{"fiber-structural", "Pick<Fiber.Fiber<number>,keyof Fiber.Fiber<number>>", 4609},
		{"deferred", "Deferred.Deferred<number>", 4610},
		{"deferred-intersection", "Deferred.Deferred<number>&{extra:1}", 4610},
		{"empty-tuple", "readonly []", 0},
		{"fiber-array", "Array<Fiber.Fiber<number>>", 0},
		{"fiber-tuple", "readonly [Fiber.Fiber<number>]", 0},
		{"fiber-record", "Record<string,Fiber.Fiber<number>>", 0},
		{"fiber-container", "{value:Fiber.Fiber<number>}", 0},
		{"fiber-marker", "{readonly '~effect/Fiber':1}", 0},
		{"deferred-marker", "{readonly '~effect/Deferred':1}", 0},
		{"fiber-optional", "Fiber.Fiber<number>|undefined", 0},
		{"deferred-optional", "Deferred.Deferred<number>|undefined", 0},
		{"mixed-targets", "Fiber.Fiber<number>|Deferred.Deferred<number>", 0},
		{"unknown", "unknown", 0}, {"any", "any", 0}, {"never", "never", 0},
		{"plain", "{value:number}", 0},
		{"fiber-correct-brand-only", "Pick<Fiber.Fiber<number>, '~effect/Fiber'>", 0},
		{"deferred-correct-brand-only", "Pick<Deferred.Deferred<number>, '~effect/Deferred'>", 0},
		{"fiber-missing-pipe", "Omit<Fiber.Fiber<number>, 'pipe'>", 0},
		{"deferred-missing-pipe", "Omit<Deferred.Deferred<number>, 'pipe'>", 0},
		{"deferred-union", "Deferred.Deferred<number>|Deferred.Deferred<string>", 4610},
		{"deferred-alias", "Pending", 4610},
		{"deferred-structural", "Pick<Deferred.Deferred<number>,keyof Deferred.Deferred<number>>", 4610},
		{"deferred-error-channel", "Deferred.Deferred<number,string>", 4610},
		{"deferred-any-channel", "Deferred.Deferred<any,any>", 4610},
		{"deferred-never-success", "Deferred.Deferred<never>", 4610},
		{"fiber-error-union", "Fiber.Fiber<number,string>|Fiber.Fiber<string,number>", 4609},
		{"deferred-union-intersection", "(Deferred.Deferred<number>|Deferred.Deferred<string>)&{extra:1}", 4610},
	}
	settings := []string{"default", "error", "suggestion", "off"}
	for _, domain := range domains {
		for _, setting := range settings {
			f.Add([]byte(domain.key + ":" + setting))
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		nativeAwaitClassifierChapter(t)
		di, si := 0, 0
		if len(data) > 0 {
			di = int(data[0]) % len(domains)
			si = int(data[len(data)-1]) % len(settings)
		}
		if p := strings.Split(string(data), ":"); len(p) == 2 {
			for i, d := range domains {
				if d.key == p[0] {
					di = i
				}
			}
			if i := slices.Index(settings, p[1]); i >= 0 {
				si = i
			}
		}
		domain, setting := domains[di], settings[si]
		key := domain.key + ":" + setting
		source := fmt.Sprintf("import type {Fiber,Deferred} from 'effect'; type Task=Fiber.Fiber<number>; type Pending=Deferred.Deferred<number>; export async function probe(value:%s) {return await value}", domain.typ)
		p := Single(source)
		var cfg map[string]any
		if err := json.Unmarshal([]byte(DefaultConfig), &cfg); err != nil {
			t.Fatal(err)
		}
		cfg["files"] = []string{"main.vibe"}
		cfg["compilerOptions"].(map[string]any)["noEmitOnError"] = true
		if setting != "default" {
			cfg["vibe"] = map[string]any{"severities": map[string]string{"EK4609": setting, "EK4610": setting}}
		}
		encoded, err := json.Marshal(cfg)
		if err != nil {
			t.Fatal(err)
		}
		p.Config = string(encoded)
		r, err := w.Compile(t.Context(), p)
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		seen := int32(0)
		category := diagnostics.CategoryWarning
		if setting == "error" {
			category = diagnostics.CategoryError
		}
		if setting == "suggestion" {
			category = diagnostics.CategorySuggestion
		}
		// Emit diagnostics can repeat a semantic error; suggestions live on
		// the suggestion API rather than the CLI compilation result.
		allDiagnostics := slices.Clone(r.Diagnostics)
		allDiagnostics = append(allDiagnostics, r.Program.GetSuggestionDiagnostics(t.Context(), r.SourceFile("main.vibe"))...)
		for _, d := range allDiagnostics {
			if d.Source() == "EK" && (d.Code() == 4609 || d.Code() == 4610) {
				if seen != 0 && seen != d.Code() || d.Code() != domain.code || setting == "off" || d.Category() != category {
					Gap(t, nativeAwaitClassifierTarget, "classify:"+key, "expected code%d category%v (off means absent), got %v\n%s", domain.code, category, Keys(r.Dir, r.Diagnostics), source)
					return
				}
				seen = d.Code()
			} else if d.Category() == diagnostics.CategoryError {
				Gap(t, nativeAwaitClassifierTarget, "native:"+key, "unexpected native error: %v", Keys(r.Dir, r.Diagnostics))
				return
			}
		}
		want := domain.code
		if setting == "off" {
			want = 0
		}
		if seen != want {
			Gap(t, nativeAwaitClassifierTarget, "missing:"+key, "want code%d, got%d\n%s", want, seen, source)
			return
		}
		shouldSkip := want != 0 && setting == "error"
		if r.EmitSkipped != shouldSkip {
			Gap(t, nativeAwaitClassifierTarget, "emit:"+key, "want noEmitOnError skip%v, got%v", shouldSkip, r.EmitSkipped)
			return
		}
		ExpectPending(t, nativeAwaitClassifierTarget, key)
		ExpectPending(t, nativeAwaitClassifierTarget, specCorpusKey(t))
	})
}
