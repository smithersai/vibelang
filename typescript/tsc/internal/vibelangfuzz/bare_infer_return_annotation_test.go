package vibelangfuzz

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const bareInferReturnTarget = "FuzzBareInferReturnAnnotation"
const bareInferReturnQuote = "Invalid native `infer` outside the set keeps `TS1338`; valid conditional inference keeps TypeScript's meaning everywhere."
const bareInferReturnBoundaryQuote = "ordinary non-Effect annotations"

var bareInferReturnForms = []struct{ key, source string }{
	{"generic-arrow", "export const identity = <A>(value: A)ANNOTATION => value;\n"},
	{"arrow", "export const identity = (value: number)ANNOTATION => value;\n"},
	{"default-arrow", "export const identity = (value: number = 3)ANNOTATION => value;\n"},
	{"destructured-arrow", "export const identity = ({ value }: { value: number })ANNOTATION => value;\n"},
	{"function", "export function identity<A>(value: A)ANNOTATION { return value; }\n"},
	{"expression", "export const identity = function<A>(value: A)ANNOTATION { return value; };\n"},
	{"object-method", "export const object = { identity<A>(value: A)ANNOTATION { return value; } };\n"},
	{"class-method", "export class Identity { identity<A>(value: A)ANNOTATION { return value; } }\n"},
	{"nested", "export function outer<A>(value: A) { function identity()ANNOTATION { return value; } return identity; }\n"},
	{"curried", "export const identity = <A>(value: A) => (next: A)ANNOTATION => [value, next] as const;\n"},
}

func TestBareInferReturnAnnotationQuoted(t *testing.T) {
	for _, quote := range []string{bareInferReturnQuote, bareInferReturnBoundaryQuote} {
		if !strings.Contains(SpecText("001-functions.md"), quote) {
			t.Fatalf("the written-infer migration boundary changed: %q", quote)
		}
	}
}

func bareInferReturnKeys() []string {
	var keys []string
	for _, form := range bareInferReturnForms {
		for _, kind := range []string{"bare", "named", "grouped"} {
			keys = append(keys, form.key+":"+kind)
		}
	}
	return keys
}

func bareInferReturnSource(t testing.TB, key string, trivia uint8) (string, string) {
	t.Helper()
	form, kind, _ := strings.Cut(key, ":")
	var source string
	for _, candidate := range bareInferReturnForms {
		if candidate.key == form {
			source = candidate.source
			break
		}
	}
	if source == "" {
		t.Fatalf("unknown return form %q", form)
	}
	annotation := map[string]string{"bare": ": infer _", "named": ": infer Result", "grouped": ": (infer _)"}[kind]
	if annotation == "" {
		t.Fatalf("unknown infer form %q", kind)
	}
	bad := strings.ReplaceAll(source, "ANNOTATION", annotation)
	good := strings.ReplaceAll(source, "ANNOTATION", "")
	if key == "generic-arrow:bare" {
		raw, err := os.ReadFile(filepath.Join(repoTestdata(), "corpus", "foldkit-bare-infer-return.vibe"))
		if err != nil {
			t.Fatal(err)
		}
		if string(raw) != bad {
			t.Fatal("the minimized corpus must retain the original return annotation")
		}
		bad = string(raw)
	}
	if trivia&1 != 0 {
		bad = strings.ReplaceAll(bad, ": infer", ": /* return type */ infer")
	}
	if trivia&2 != 0 {
		bad, good = strings.ReplaceAll(bad, "\n", "\r\n"), strings.ReplaceAll(good, "\n", "\r\n")
	}
	return bad, good
}

func bareInferReturnErrors(r *Result) []string {
	var codes []string
	for _, d := range r.Diagnostics {
		if d.Category() == diagnostics.CategoryError {
			prefix := d.Source()
			if prefix == "" {
				prefix = "TS"
			}
			codes = append(codes, fmt.Sprintf("%s%d", prefix, d.Code()))
		}
	}
	return codes
}

func checkBareInferReturn(t *testing.T, w *Workspace, key string, trivia uint8) {
	t.Helper()
	bad, good := bareInferReturnSource(t, key, trivia)
	// Missing annotations and ordinary conditional inference remain legal.
	control := good + "export type Unwrap<T> = T extends { value: infer A } ? A : never;\nexport const checked: Unwrap<{ value: number }> = 1;\n"
	valid, err := w.Compile(t.Context(), Single(control))
	if err != nil {
		t.Fatal(err)
	}
	defer valid.Remove()
	if codes := bareInferReturnErrors(valid); len(codes) != 0 {
		t.Fatalf("ordinary inference control must compile: %v\n%s", codes, control)
	}
	native, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.ts": bad}})
	if err != nil {
		t.Fatal(err)
	}
	defer native.Remove()
	if codes := bareInferReturnErrors(native); !slices.Contains(codes, "TS1338") {
		t.Fatalf("TypeScript source must retain TS1338: %v\n%s", codes, bad)
	}
	result, err := w.Compile(t.Context(), Single(bad))
	if err != nil {
		t.Fatal(err)
	}
	defer result.Remove()
	codes := bareInferReturnErrors(result)
	if !slices.Contains(codes, "TS1338") || slices.Contains(codes, "EK4857") {
		Gap(t, bareInferReturnTarget, "ts1338:"+key, "VIP-3: %q; ordinary return annotation must keep TS1338, not the Effect-channel migration; got %v\n%s", bareInferReturnQuote, codes, bad)
	}
	ExpectPending(t, bareInferReturnTarget, "ts1338:"+key)
	ExpectPending(t, bareInferReturnTarget, specCorpusKey(t))
}

func TestBareInferReturnAnnotationWitness(t *testing.T) {
	TestBareInferReturnAnnotationQuoted(t)
	checkBareInferReturn(t, NewWorkspace(t), "generic-arrow:bare", 0)
}

// Batch independent stock TypeScript controls once, rather than launching a
// stock compiler for every generated trivia mutation.
func TestBareInferReturnAnnotationStock(t *testing.T) {
	TestBareInferReturnAnnotationQuoted(t)
	w, tsc := NewWorkspace(t), StockTypeScript(t)
	for _, invalid := range []bool{false, true} {
		files := map[string]string{}
		for _, key := range bareInferReturnKeys() {
			bad, good := bareInferReturnSource(t, key, 0)
			name := strings.ReplaceAll(key, ":", "_") + ".ts"
			files[name] = good
			if invalid {
				files[name] = bad
			}
		}
		dir, err := w.writeProject(Project{Files: files})
		if err != nil {
			t.Fatal(err)
		}
		defer os.RemoveAll(dir)
		ctx, cancel := context.WithTimeout(t.Context(), HangLimit)
		cmd := exec.CommandContext(ctx, tsc, "-p", ".", "--pretty", "false", "--noEmit")
		cmd.Dir = dir
		output, runErr := cmd.CombinedOutput()
		contextErr := ctx.Err()
		cancel()
		if contextErr != nil || !invalid && runErr != nil || invalid && runErr == nil {
			t.Fatalf("stock TypeScript invalid=%t: exit=%v context=%v\n%s", invalid, runErr, contextErr, output)
		}
		if invalid {
			for name := range files {
				found := false
				for _, line := range strings.Split(string(output), "\n") {
					found = found || strings.Contains(line, name+"(") && strings.Contains(line, "error TS1338:")
				}
				if !found {
					t.Fatalf("stock TypeScript omitted TS1338 for %s\n%s", name, output)
				}
			}
		}
		t.Logf("stock TypeScript: invalid=%t, %d return forms checked", invalid, len(files))
	}
}

func FuzzBareInferReturnAnnotation(f *testing.F) {
	startShortBudget(f)
	keys := bareInferReturnKeys()
	for _, key := range keys {
		f.Add(key, uint8(0))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, trivia uint8) {
		TestBareInferReturnAnnotationQuoted(t)
		key = strings.TrimPrefix(key, "key:")
		if !slices.Contains(keys, key) {
			if key == "" {
				key = keys[0]
			} else {
				key = keys[int(key[0])%len(keys)]
			}
		}
		checkBareInferReturn(t, w, key, trivia)
	})
}
