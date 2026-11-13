package vibelangfuzz

import (
	"context"
	"encoding/json"
	"fmt"
	"maps"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

// VIP-27 retains the named TypeScript 7.0.2 declaration baseline only for
// repeated anonymous types. Other TS5088 sites and native checks remain strict.
func recursiveParityBaseline(t *testing.T, w *Workspace, project Project, fork *Compilation, spans []stockSpan, written map[string]string) ([]stockSpan, map[string]string, bool) {
	t.Helper()
	if !slices.ContainsFunc(spans, func(s stockSpan) bool { return s.Code == 5088 }) {
		return spans, written, false
	}
	cache := filepath.Join(Root(), "packages/ts-mapper/test/.cache/typescript-7.0.2/node_modules")
	metadata, err := os.ReadFile(filepath.Join(cache, "typescript/package.json"))
	if err != nil {
		t.Fatalf("install the VIP-27 stock declaration baseline as CONTRIBUTING.md describes: %v", err)
	}
	var manifest struct{ Version string }
	if json.Unmarshal(metadata, &manifest) != nil || manifest.Version != "7.0.2" {
		t.Fatal("the declaration baseline must be TypeScript 7.0.2")
	}
	dir, err := os.MkdirTemp(w.Dir, "cycle-stock-")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(dir)
	for name := range project.Files {
		data, err := os.ReadFile(filepath.Join(fork.Dir, name))
		if err != nil {
			t.Fatal(err)
		}
		path := filepath.Join(dir, name)
		if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, data, 0600); err != nil {
			t.Fatal(err)
		}
	}
	config, err := os.ReadFile(filepath.Join(fork.Dir, "tsconfig.json"))
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "tsconfig.json"), config, 0600); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(t.Context(), stockChildLimit())
	defer cancel()
	tsc := filepath.Join(cache, ".bin/tsc")
	cmd := exec.CommandContext(ctx, tsc, "-p", ".", "--pretty", "false")
	cmd.Dir = dir
	out, runErr := combinedChildOutput(cmd)
	if exit, ok := runErr.(*exec.ExitError); runErr != nil && (!ok || exit.ExitCode() > 2) {
		t.Fatalf("stock declaration baseline failed: %v: %s", runErr, out)
	}
	var sourceNames []string
	for name := range project.Files {
		if isTypeScript(name) && fork.SourceFile(name) != nil {
			sourceNames = append(sourceNames, name)
		}
	}
	slices.Sort(sourceNames)
	baseline, _, err := stockSpans(ctx, tsc, dir, sourceNames...)
	if err != nil {
		t.Fatal(err)
	}
	outputs := readParityOutputs(dir, project.Files)
	from := map[string]string{}
	for name, file := range fork.From {
		if file != nil {
			relative, err := filepath.Rel(fork.Dir, string(file.FileName()))
			if err != nil {
				t.Fatal(err)
			}
			from[name] = filepath.ToSlash(relative)
		}
	}
	// Record only structure and sizes, never the generated program's contents.
	// A baseline refusal must identify the differing source, emit or map guard.
	type outputReceipt struct {
		Name, Source                             string
		NativeBytes, BaselineBytes, CurrentBytes int
		SameBaseline, HasElision                 bool
	}
	var receipts []outputReceipt
	for _, name := range slices.Sorted(maps.Keys(fork.Outputs)) {
		text := fork.Outputs[name]
		receipts = append(receipts, outputReceipt{name, from[name], len(text), len(outputs[name]), len(written[name]), text == outputs[name], strings.Contains(text, "/*elided*/ any")})
	}
	t.Logf("recursive declaration baseline: current_spans=%v historical_spans=%v no_emit_on_error=%t outputs=%+v",
		spanStrings(spans), spanStrings(baseline), fork.Program.Options().NoEmitOnError.IsTrue(), receipts)
	acceptedSpans, acceptedOutputs, ok := cycleParityExpectation(spans, baseline, fork.Outputs, written, outputs, from, fork.Program.Options().NoEmitOnError.IsTrue())
	if ok {
		t.Logf("VIP-27: verified anonymous cycle declarations against stock TypeScript %s; retained %d native diagnostic spans", manifest.Version, len(acceptedSpans))
	}
	return acceptedSpans, acceptedOutputs, ok
}

func cycleParityExpectation(stock, baseline []stockSpan, emitted, written, fallback, from map[string]string, noEmitOnError bool) ([]stockSpan, map[string]string, bool) {
	unchanged := func() ([]stockSpan, map[string]string, bool) { return stock, written, false }
	var filtered []stockSpan
	sources := map[string]bool{}
	for _, span := range stock {
		if span.Code == 5088 && span.File != "" {
			sources[span.File] = true
		} else {
			filtered = append(filtered, span)
		}
	}
	if len(sources) == 0 || !slices.Equal(spanStrings(filtered), spanStrings(baseline)) {
		return unchanged()
	}
	eligible := map[string]bool{}
	for source := range sources {
		found := false
		for name, text := range emitted {
			if from[name] != source || !isDeclaration(name) {
				continue
			}
			// An unrelated or changed declaration never becomes an approved cycle.
			if !strings.Contains(text, "/*elided*/ any") || fallback[name] != text {
				return unchanged()
			}
			found = true
			eligible[name] = true
			if _, ok := emitted[name+".map"]; ok {
				if fallback[name+".map"] != emitted[name+".map"] {
					return unchanged()
				}
				eligible[name+".map"] = true
			}
		}
		if !found {
			return unchanged()
		}
	}
	patched := maps.Clone(written)
	nativeError := slices.ContainsFunc(filtered, func(s stockSpan) bool { return s.Category == "error" })
	for name, text := range fallback {
		if _, exists := written[name]; exists {
			continue
		}
		// A sole approved cycle may stop all stock emit under noEmitOnError.
		// Every replacement must still be byte-identical to the named baseline.
		if eligible[name] || noEmitOnError && !nativeError {
			if emitted[name] != text {
				return unchanged()
			}
			patched[name] = text
		}
	}
	return filtered, patched, true
}

func readParityOutputs(dir string, inputs map[string]string) map[string]string {
	written := map[string]string{}
	err := filepath.WalkDir(dir, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			if entry.Name() == "node_modules" {
				return filepath.SkipDir
			}
			return nil
		}
		name, err := filepath.Rel(dir, path)
		if err != nil {
			return err
		}
		name = filepath.ToSlash(name)
		if _, input := inputs[name]; input || name == "tsconfig.json" || !parityOutput(name) {
			return nil
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		written[name] = string(data)
		return nil
	})
	if err != nil {
		panic(fmt.Errorf("read stock outputs: %w", err))
	}
	return written
}
