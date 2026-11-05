package vibelangfuzz

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
	"path/filepath"
	"strings"
	"testing"
)

func TestEffectFnBareReturnContractsQuoted(t *testing.T) {
	if !strings.Contains(SpecText("007-tooling.md"), fixGeneratorReturnQuote) {
		t.Fatal("quick-fix preservation rule changed")
	}
}

func FuzzEffectFnBareReturnContracts(f *testing.F) {
	startShortBudget(f)
	keys := []string{"generic", "number", "union", "void", "undefined", "optional"}
	for _, key := range keys {
		f.Add(key, uint8(0))
	}
	f.Add("key-fallback", uint8(0))
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, variant uint8) {
		TestEffectFnBareReturnContractsQuoted(t)
		known := false
		for _, candidate := range keys {
			if key == candidate {
				known = true
			}
		}
		if !known {
			if key == "" {
				return
			}
			key = keys[int(key[0])%len(keys)]
		}
		probeKey := fmt.Sprintf("feature:%s:%d", key, variant&3)
		resultType, params, allowed := "A", "<A>(value: A)", false
		switch key {
		case "generic":
		case "number":
			resultType, params = "number", "(value: number)"
		case "union":
			resultType, params = "number | string", "(value: number)"
		case "void":
			resultType, params, allowed = "void", "(value: number)", true
		case "undefined":
			resultType, params, allowed = "undefined", "(value: number)", true
		case "optional":
			resultType, params, allowed = "number | undefined", "(value: number)", true
		default:
			return
		}
		body := "yield* Effect.succeed(value); return"
		if variant&2 != 0 {
			body = "function ignored() { return }; { " + body + " }"
		}
		source := fmt.Sprintf("// keep return-contract comment 🧪\nimport * as Effect from \"effect/Effect\"\nexport const identity = Effect.fn(\"identity\")(function* %s: Effect.fn.Return<%s> { %s })\n", params, resultType, body)
		if variant&1 != 0 {
			source = strings.ReplaceAll(source, "\n", "\r\n")
		}
		files := map[string]string{"main.vibe": source}
		before := toolsCompile(t, w, "FuzzEffectFnBareReturnContracts", files)
		defer before.Remove()
		if !allowed {
			found := false
			for _, d := range before.Diagnostics {
				if d.Code() == 2322 {
					found = true
				}
			}
			if !found {
				t.Fatal("invalid return fixture lost its native TS2322 control")
			}
		}
		fixed := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, before.Dir), vibelang.FixOptions{})
		after := source
		for name, file := range fixed.Files {
			if filepath.Base(name.AsString()) == "main.vibe" {
				after = file.Text
			}
		}
		if !allowed {
			if after != source {
				Gap(t, "FuzzEffectFnBareReturnContracts", probeKey, "Chapter 7: refused contract changed:\n%s", after)
			}
			ExpectPending(t, "FuzzEffectFnBareReturnContracts", probeKey)
			return
		}
		if strings.Contains(after, "Effect.fn(") {
			Gap(t, "FuzzEffectFnBareReturnContracts", probeKey, "Chapter 7: valid contract refused:\n%s", after)
		}
		if !strings.Contains(after, "keep return-contract comment") {
			Gap(t, "FuzzEffectFnBareReturnContracts", probeKey, "Chapter 7: comment lost")
		}
		compiled := toolsCompile(t, w, "FuzzEffectFnBareReturnContracts", map[string]string{"main.vibe": after})
		defer compiled.Remove()
		if !toolsErrorFree(compiled) {
			Gap(t, "FuzzEffectFnBareReturnContracts", probeKey, "Chapter 7: valid migrated contract has diagnostics: %v\n%s", compiled.Diagnostics, after)
		}
		ExpectPending(t, "FuzzEffectFnBareReturnContracts", probeKey)
	})
}
