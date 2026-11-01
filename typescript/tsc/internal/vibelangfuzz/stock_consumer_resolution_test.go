package vibelangfuzz

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

const stockConsumerResolutionQuote = "A package whose sources spell relative imports another way keeps that spelling with the project setting `vibelang.declarationImportStyle`"

func TestStockConsumerResolutionQuoted(t *testing.T) {
	if !strings.Contains(SpecText("001-functions.md"), stockConsumerResolutionQuote) {
		t.Fatalf("current declaration-output rule no longer says %q", stockConsumerResolutionQuote)
	}
}

var stockConsumerModes = []struct{ key, module, resolution, suffix string }{
	{"preserve-bundler", "preserve", "bundler", ""},
	{"esnext-bundler", "esnext", "bundler", ""},
	{"nodenext-js", "nodenext", "nodenext", ".js"},
	{"node16-js", "node16", "node16", ".js"},
	{"preserve-ts", "preserve", "bundler", ".ts"},
}

func stockConsumerResolutionWitness(t *testing.T, key string, variant uint8) {
	t.Helper()
	TestStockConsumerResolutionQuoted(t)
	mode := stockConsumerModes[int(variant)%len(stockConsumerModes)]
	for _, candidate := range stockConsumerModes {
		if candidate.key == key {
			mode = candidate
			break
		}
	}
	tsc, err := stockTypeScript()
	if err != nil {
		Missing(t, "%v", err)
	}
	root := t.TempDir()
	dir := filepath.Join(root, "mirror")
	if err := os.Mkdir(dir, 0700); err != nil {
		t.Fatal(err)
	}
	scalar := []string{"number", "string", "boolean"}[int(variant)%3]
	reexport := "export type { Result } from "
	if variant&4 != 0 {
		reexport = "export type * from "
	}
	files := map[string]string{
		"package.json":   `{"type":"module"}`,
		"dep.d.ts":       "export interface Result { readonly value: " + scalar + " }\n",
		"index.d.ts":     fmt.Sprintf("%s%q;\n", reexport, "./dep"+mode.suffix),
		"__consumer.mts": "import type { Result } from \"./index.js\"; export type Value = Result[\"value\"];\n",
		"tsconfig.json":  `{"files":["__consumer.mts","index.d.ts","dep.d.ts"]}`,
	}
	for name, text := range files {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(text), 0600); err != nil {
			t.Fatal(err)
		}
	}
	producer, err := json.Marshal(map[string]any{"compilerOptions": map[string]any{"module": mode.module, "moduleResolution": mode.resolution, "allowImportingTsExtensions": true}, "vibe": map[string]any{"effectGlobals": false}})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "tsconfig.json"), producer, 0600); err != nil {
		t.Fatal(err)
	}
	config, err := stockConsumerConfig(dir)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(t.Context(), HangLimit)
	defer cancel()
	cmd := exec.CommandContext(ctx, tsc, "-p", config, "--pretty", "false")
	cmd.Dir = dir
	output, err := cmd.CombinedOutput()
	if err != nil {
		Gap(t, "FuzzStockConsumerResolution", "resolution:"+mode.key, "VIP-27 declaration spelling follows the native resolution policy: %v: %s", err, output)
	}
}

func TestStockConsumerResolution(t *testing.T) {
	for _, mode := range stockConsumerModes {
		for _, variant := range []uint8{0, 1, 2, 4} {
			t.Run(fmt.Sprintf("%s/%d", mode.key, variant), func(t *testing.T) { stockConsumerResolutionWitness(t, mode.key, variant) })
		}
	}
}

func FuzzStockConsumerResolution(f *testing.F) {
	startShortBudget(f)
	for _, mode := range stockConsumerModes {
		f.Add(mode.key, uint8(0))
	}
	f.Fuzz(func(t *testing.T, key string, variant uint8) { stockConsumerResolutionWitness(t, key, variant) })
}
