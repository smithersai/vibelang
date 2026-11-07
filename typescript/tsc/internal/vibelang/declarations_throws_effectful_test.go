package vibelang

import (
	"strings"
	"testing"
)

// The declaration-output example in Chapter 1 explicitly leaves Stream
// returns untagged, alongside Effect. These are deferred return channels.
func TestVIP27EffectfulReturnChannels(t *testing.T) {
	for name, source := range map[string]string{
		"stream":             "export function sample(): Stream.Stream<number> { return {} as Stream.Stream<number> }",
		"layer":              "export const sample = (): Layer.Layer<never> => ({} as Layer.Layer<never>)",
		"constrained-effect": "export interface Sample { method<T extends Effect.Effect<number>>(): T }",
		"signatures":         "export interface Sample { method(): Stream.Stream<number>; (): Layer.Layer<never> }",
	} {
		t.Run(name, func(t *testing.T) {
			files := computedKeyFiles(false)
			base := "/workspace/x/src/"
			files[base+"node_modules/effect/index.d.ts"] += "; export * as Stream from './dist/Stream.js'; export * as Layer from './Layer.js'"
			files[base+"node_modules/effect/dist/Stream.d.ts"] = "export interface Stream<A, E = never, R = never> { readonly \"~effect/Stream\": { readonly _A: (_: never) => A; readonly _E: (_: never) => E; readonly _R: (_: never) => R }; readonly channel: unknown; pipe(): unknown }"
			files[base+"node_modules/effect/Layer.d.ts"] = "export interface Layer<A, E = never, R = never> { readonly \"~effect/Layer\": { readonly _ROut: (_: A) => void; readonly _E: (_: never) => E; readonly _RIn: (_: never) => R } }"
			files[base+"main.vibe"] = "import { Effect, Stream, Layer } from 'effect'; " + source
			dts := emitDeclarations(t, files)
			if strings.Contains(dts, "@throws {never}") {
				t.Fatalf("effectful signatures must retain their return-channel contract:\nsource:\n%s\ndeclaration:\n%s", source, dts)
			}
		})
	}
}

// A marker-only view is not a Stream return contract. Keep the ordinary
// generated throws contract for it while complete Stream signatures stay untagged.
func TestVIP27PartialStreamRetainsThrowsContract(t *testing.T) {
	files := computedKeyFiles(false)
	base := "/workspace/x/src/"
	files[base+"node_modules/effect/index.d.ts"] += "; export * as Stream from './dist/Stream.js'"
	files[base+"node_modules/effect/dist/Stream.d.ts"] = "export interface Stream<A, E = never, R = never> { readonly \"~effect/Stream\": { readonly _A: (_: never) => A; readonly _E: (_: never) => E; readonly _R: (_: never) => R }; readonly channel: unknown; pipe(): unknown }"
	files[base+"main.vibe"] = "import { Stream } from 'effect'; export function sample(): Pick<Stream.Stream<number>, \"~effect/Stream\"> { return {} as Pick<Stream.Stream<number>, \"~effect/Stream\"> }"
	dts := emitDeclarations(t, files)
	if !strings.Contains(dts, "@throws {never}") {
		t.Fatalf("an incomplete Stream view lost its plain declaration contract:\n%s", dts)
	}
}
