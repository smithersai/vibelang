package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
	"testing"
)

// Native iteration has no implicit-Stream migration provenance (detail293).
// A migration switch and the operand's Stream shape must not select a new protocol.
func TestStreamLoopMigrationPreservesNativeProtocols(t *testing.T) {
	for _, tc := range []struct{ name, source string }{
		{"sync-dual", "export function main(rows:Stream.Stream<number>&Iterable<number>):void{for(const row of rows){void row}}"},
		{"async-dual", "export async function main(rows:Stream.Stream<number>&AsyncIterable<number>):Promise<void>{for await(const row of rows){void row}}"},
		{"async-sync-fallback", "export async function main(rows:Stream.Stream<number>&Iterable<number>):Promise<void>{for await(const row of rows){void row}}"},
		{"effect-sync-dual", "export effect function main(rows:Stream.Stream<number>&Iterable<number>){for(const row of rows){void row}}"},
		{"effect-async-dual", "export effect function main(rows:Stream.Stream<number>&AsyncIterable<number>){for await(const row of rows){void row}}"},
		{"native-any", "export function main(rows:any):void{for(const row of rows){void row}}"},
		{"shadowed", "export function main(Stream:readonly number[]):void{for(const row of Stream){void row}}"},
		{"plain-stream", "export function main(rows:Stream.Stream<number>):void{for(const row of rows){void row}}"},
		{"async-stream", "export async function main(rows:Stream.Stream<number>):Promise<void>{for await(const row of rows){void row}}"},
		{"return", "export effect function main(rows:Stream.Stream<number>&Iterable<number>){for(const row of rows){return row};return 0}"},
		{"outward-jump", "export effect function main(rows:Stream.Stream<number>&Iterable<number>){outer: for(const x of [1]){for(const row of rows){if(row===x)continue outer}}}"},
		{"assignment", "export function main(rows:Stream.Stream<number>&Iterable<number>):void{let row:number;for(row of rows){void row}}"},
		{"destructuring", "export function main(rows:Stream.Stream<number>&Iterable<{readonly x:number}>):void{for(const {x} of rows){void x}}"},
		{"native-async-iterable", "export async function main(rows:AsyncIterable<number>):Promise<void>{for await(const row of rows){void row}}"},
	} {
		for _, mode := range []struct {
			name    string
			options FixOptions
		}{{"migration", FixOptions{MigrationOnly: true}}, {"vip", FixOptions{VIPOnly: true}}} {
			t.Run(tc.name+"/"+mode.name, func(t *testing.T) {
				p, _, _, _ := editorProgram(t, "import {Stream} from 'effect';"+tc.source)
				result := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), p.CommandLine(), mode.options)
				if len(result.Files) != 0 || len(result.Refused) != 0 {
					t.Fatalf("native loop has no proved legacy migration: %+v", result)
				}
			})
		}
	}
}
