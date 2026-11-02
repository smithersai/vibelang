package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"testing"
)

func TestNativeStreamProtocolAdmission(t *testing.T) {
	for _, d := range []struct {
		key, source string
		codes       []int32
	}{
		{"sync-dual", "export function main(rows:Stream.Stream<number>&Iterable<string>):void{for(const row of rows){const text:string=row}}", nil},
		{"async-dual", "export async function main(rows:Stream.Stream<number>&AsyncIterable<string>):Promise<void>{for await(const row of rows){const text:string=row}}", nil},
		{"async-sync-fallback", "export async function main(rows:Stream.Stream<number>&Iterable<string>):Promise<void>{for await(const row of rows){const text:string=row}}", nil},
		{"effect-sync-dual", "export effect function main(rows:Stream.Stream<number>&Iterable<string>){for(const row of rows){const text:string=row}}", nil},
		{"alias-sync", "type Both=Stream.Stream<number>&Iterable<string>;export function main(rows:Both):void{for(const row of rows){const text:string=row}}", nil},
		{"union-sync", "export function main(rows:(Stream.Stream<number>&Iterable<string>)|(Stream.Stream<boolean>&Iterable<string>)):void{for(const row of rows){const text:string=row}}", nil},
		{"native-return", "export function main(rows:Stream.Stream<number>&Iterable<string>):string{for(const row of rows){return row};return 'empty'}", nil},
		{"native-destructuring", "export function main(rows:Stream.Stream<number>&Iterable<{x:string}>):void{for(const {x} of rows){const text:string=x}}", nil},
		{"native-any", "export function main(rows:any):void{for(const row of rows){}}", nil},
		{"native-array", "export function main(Stream:readonly number[]):void{for(const row of Stream){const n:number=row}}", nil},
		{"native-pure-stream", "export function main(rows:Stream.Stream<number>):void{for(const row of rows){}}", []int32{2488}},
		{"native-async-pure-stream", "export async function main(rows:Stream.Stream<number>):Promise<void>{for await(const row of rows){}}", []int32{2504}},
		{"effect-async-dual", "export effect function main(rows:Stream.Stream<number>&AsyncIterable<string>){for await(const row of rows){const text:string=row}}", []int32{102}},
	} {
		t.Run(d.key, func(t *testing.T) {
			p, f, _, _ := editorProgram(t, "import {Stream} from 'effect';"+d.source)
			found := map[int32]int{}
			for _, x := range append(p.GetSyntacticDiagnostics(t.Context(), f), p.GetSemanticDiagnostics(t.Context(), f)...) {
				if x.Category() == diagnostics.CategoryError {
					found[x.Code()]++
					t.Log(x.String())
				}
			}
			for _, code := range d.codes {
				if found[code] != 1 {
					t.Errorf("want one %d, got %v", code, found)
				}
				delete(found, code)
			}
			if len(found) != 0 {
				t.Errorf("unexpected errors %v", found)
			}
		})
	}
}
