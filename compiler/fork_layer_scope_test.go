package compiler

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
)

// requirements.mdx §Scoping: keep a provider through its returned Promise;
// isolate siblings and preserve nesting/cleanup. These are execution tests,
// shared with the reference, not a check for a particular emitter shape.
func TestPinnedForkLayerScopeExecution(t *testing.T) {
	data, err := os.ReadFile("layer-scope-vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var vectors struct {
		Head  string
		Cases []struct {
			Name, Body, Code string
			Output           []string
		}
	}
	if err := json.Unmarshal(data, &vectors); err != nil {
		t.Fatal(err)
	}
	backend, ctx := newPinnedTestBackend(t)
	for _, vector := range vectors.Cases {
		t.Run(vector.Name, func(t *testing.T) {
			result, err := backend.Compile(ctx, CompileRequest{RootNames: []string{"main.vibe"}, Lowering: LoweringInternal,
				Files: []SourceFile{{Path: "main.vibe", Kind: FileKindVibeLang, Text: vectors.Head + vector.Body}},
			})
			if err != nil {
				t.Fatal(err)
			}
			if vector.Code != "" {
				requireCode(t, result, vector.Code, "")
				if !result.EmitSkipped || len(result.Artifacts) != 0 {
					t.Fatal("unowned async work emitted executable code")
				}
				return
			}
			if result.EmitSkipped || len(result.Diagnostics) != 0 {
				t.Fatalf("valid provider scope refused: %v", ambientChargeMessages(result))
			}
			if got, want := runEmittedMain(t, result), strings.Join(vector.Output, "\n"); got != want {
				t.Fatalf("provider returned %q; want %q", got, want)
			}
		})
	}
}

func TestPinnedForkLayerScopeRuntimeBoundaries(t *testing.T) {
	result := compileInternalSource(t, []SourceFile{{Path: "main.vibe", Kind: FileKindVibeLang, Text: `
import { Context } from "vibelang/context";
export abstract class Db extends Context { abstract value(): number }
`}})
	observed := executeEmitted(t, result.Artifacts, `
import { runInNewContext } from "node:vm";
import { Layer, vibelangIsPanic as isPanic } from "./__vibelang_prelude.js";
import { Db } from "./main.js";
const layer = Layer.succeed(Db, { value: () => 7 });
const read = () => { try { return Db.context().value(); } catch (error) { if (isPanic(error)) return "revoked"; throw error; } };
const observed = {};

const existing = Promise.resolve(41);
observed.samePromise = Layer.provide(layer, () => existing) === existing;
await existing;
const foreign = runInNewContext("Promise.resolve(42)");
observed.sameCrossRealmPromise = Layer.provide(layer, () => foreign) === foreign;
observed.crossRealmValue = await foreign;

let escaped;
observed.syncValue = Layer.provide(layer, () => {
  escaped = Promise.resolve().then(read);
  return read();
});
observed.syncRevoked = await escaped;
try {
  Layer.provide(layer, () => {
    escaped = Promise.resolve().then(read);
    throw new Error("sync failure");
  });
} catch (error) { observed.syncFailure = error.message; }
observed.syncFailureRevoked = await escaped;

for (const fails of [false, true]) {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  try {
    observed.asyncValue = await Layer.provide(layer, async () => {
      escaped = (async () => { await gate; return read(); })();
      await Promise.resolve();
      if (fails) throw new Error("async failure");
      return read();
    });
  } catch (error) { observed.asyncFailure = error.message; }
  // A Layer is not a nursery: it must finish before this hidden child does.
  release();
  observed[fails ? "asyncFailureRevoked" : "asyncRevoked"] = await escaped;
}

observed.forgedRefused = [{}, { ...layer }, Object.create(layer), new Proxy(layer, {})].every(value => {
  try { Layer.provide(value, () => 1); return false; } catch (error) { return isPanic(error); }
});
try { Layer.merge(layer, layer); observed.duplicateMerge = false; }
catch (error) { observed.duplicateMerge = error instanceof TypeError; }
try { Layer.provide(layer, () => Layer.provide(layer, () => 1)); observed.nestedOverride = false; }
catch (error) { observed.nestedOverride = error instanceof TypeError; }
observed.outside = read();
console.log(JSON.stringify(observed));
`)
	for key, want := range map[string]any{
		"samePromise": true, "sameCrossRealmPromise": true, "crossRealmValue": 42,
		"syncValue": 7, "syncRevoked": "revoked", "syncFailure": "sync failure", "syncFailureRevoked": "revoked",
		"asyncValue": 7, "asyncRevoked": "revoked", "asyncFailure": "async failure", "asyncFailureRevoked": "revoked",
		"forgedRefused": true, "duplicateMerge": true, "nestedOverride": true, "outside": "revoked",
	} {
		expectObserved(t, observed, key, want)
	}
}

func TestPinnedForkLayerScopeHostDeclarationsGrantNoAuthority(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	for _, declaration := range []string{
		`import { AsyncLocalStorage } from "node:async_hooks";`,
		`import { isPromise } from "node:util/types";`,
	} {
		result, err := backend.Compile(ctx, CompileRequest{RootNames: []string{"main.vibe"}, Lowering: LoweringInternal,
			Files: []SourceFile{{Path: "main.vibe", Kind: FileKindVibeLang, Text: declaration + ` export function main(): string[] { return ["unreachable"] }`}},
		})
		if err != nil {
			t.Fatal(err)
		}
		requireCode(t, result, "VIBE1510", "module")
		if !result.EmitSkipped || len(result.Artifacts) != 0 {
			t.Fatal("a compiler host declaration granted authority to authored code")
		}
	}
}
