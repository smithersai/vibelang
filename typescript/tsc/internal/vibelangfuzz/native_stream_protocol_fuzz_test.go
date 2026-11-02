package vibelangfuzz

import (
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"slices"
	"sort"
	"strings"
	"testing"
)

const nativeStreamProtocolTarget = "FuzzNativeStreamProtocols"

func nativeStreamProtocolChapter(t testing.TB) {
	t.Helper()
	for _, q := range []struct{ file, text string }{
		{"001-functions.md", "its result, as in TypeScript"},
		{"002-running.md", "It mirrors `for await` over AsyncIterables, which keeps its JavaScript meaning."},
		{"900-appendices.md", "`await`, `for await` or `await using` in effect code"},
	} {
		if !strings.Contains(SpecText(q.file), q.text) {
			t.Fatalf("stale native protocol quote in %s", q.file)
		}
	}
}
func TestNativeStreamProtocolsQuoted(t *testing.T) { nativeStreamProtocolChapter(t) }

var nativeStreamProtocolDomains = []struct{ key, source string }{
	{"sync-dual", "export function main(rows:Stream.Stream<number>&Iterable<string>):void{for(const row of rows){const text:string=row}}"},
	{"async-dual", "export async function main(rows:Stream.Stream<number>&AsyncIterable<string>):Promise<void>{for await(const row of rows){const text:string=row}}"},
	{"async-sync-fallback", "export async function main(rows:Stream.Stream<number>&Iterable<string>):Promise<void>{for await(const row of rows){const text:string=row}}"},
	{"effect-sync-dual", "export effect function main(rows:Stream.Stream<number>&Iterable<string>){for(const row of rows){const text:string=row}}"},
	{"alias-sync", "type Both=Stream.Stream<number>&Iterable<string>;export function main(rows:Both):void{for(const row of rows){const text:string=row}}"},
	{"union-sync", "export function main(rows:(Stream.Stream<number>&Iterable<string>)|(Stream.Stream<boolean>&Iterable<string>)):void{for(const row of rows){const text:string=row}}"},
	{"native-return", "export function main(rows:Stream.Stream<number>&Iterable<string>):string{for(const row of rows){return row};return 'empty'}"},
	{"native-destructuring", "export function main(rows:Stream.Stream<number>&Iterable<{x:string}>):void{for(const {x} of rows){const text:string=x}}"},
	{"native-any", "export function main(rows:any):void{for(const row of rows){}}"},
	{"native-array", "export function main(Stream:readonly number[]):void{for(const row of Stream){const n:number=row}}"},
	{"native-pure-stream", "export function main(rows:Stream.Stream<number>):void{for(const row of rows){}}"},
	{"native-async-pure-stream", "export async function main(rows:Stream.Stream<number>):Promise<void>{for await(const row of rows){}}"},
	{"effect-async-dual", "export effect function main(rows:Stream.Stream<number>&AsyncIterable<string>){for await(const row of rows){const text:string=row}}"},
	{"native-unknown", "export function main(rows:unknown):void{for(const row of rows){}}"},
	{"native-never", "export function main(rows:never):void{for(const row of rows){}}"},
	{"native-optional", "export function main(rows:(Stream.Stream<number>&Iterable<string>)|undefined):void{for(const row of rows){}}"},
	{"mixed-native-union", "export function main(rows:(Stream.Stream<number>&Iterable<string>)|Iterable<string>):void{for(const row of rows){const text:string=row}}"},
	{"effect-async-pure-stream", "export effect function main(rows:Stream.Stream<number>){for await(const row of rows){}}"},
	{"native-async-destructuring", "export async function main(rows:Stream.Stream<number>&AsyncIterable<{x:string}>):Promise<void>{for await(const {x} of rows){const text:string=x}}"},
	{"native-assignment-head", "export function main(rows:Stream.Stream<number>&Iterable<string>):void{let row:string;for(row of rows){const text:string=row}}"},
	{"native-plain-await", "export function main(rows:Stream.Stream<number>&AsyncIterable<string>):void{for await(const row of rows){const text:string=row}}"},
	{"native-top-sync", "declare const rows:Stream.Stream<number>&Iterable<string>;for(const row of rows){const text:string=row}"},
	{"native-top-await", "declare const rows:Stream.Stream<number>&AsyncIterable<string>;for await(const row of rows){const text:string=row}"},
	{"native-async-method", "export class Reader {async read(rows:Stream.Stream<number>&AsyncIterable<string>):Promise<void>{for await(const row of rows){const text:string=row}}}"},
	{"nested-native-async", "export effect function main(){async function consume(rows:Stream.Stream<number>&AsyncIterable<string>):Promise<void>{for await(const row of rows){const text:string=row}};void consume}"},
}

func FuzzNativeStreamProtocols(f *testing.F) {
	startShortBudget(f)
	nativeStreamProtocolChapter(f)
	for _, d := range nativeStreamProtocolDomains {
		for _, binding := range []string{"const", "let"} {
			f.Add([]byte(d.key + ":" + binding))
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		nativeStreamProtocolChapter(t)
		di, mutable := 0, false
		if len(data) > 0 {
			di = int(data[0]) % len(nativeStreamProtocolDomains)
			mutable = data[len(data)-1]%2 != 0
		}
		parts := strings.Split(string(data), ":")
		if len(parts) == 2 {
			for i, d := range nativeStreamProtocolDomains {
				if parts[0] == d.key {
					di = i
				}
			}
			mutable = parts[1] == "let"
		}
		d := nativeStreamProtocolDomains[di]
		binding := "const"
		if mutable {
			binding = "let"
		}
		key := d.key + ":" + binding
		vibe := d.source
		if mutable {
			vibe = strings.ReplaceAll(vibe, "const row", "let row")
			vibe = strings.ReplaceAll(vibe, "const {", "let {")
		}
		native := strings.ReplaceAll(vibe, "export effect function", "export async function")
		prefix := "import {Stream} from 'effect';"
		reference, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.ts": prefix + native}})
		if err != nil {
			t.Fatal(err)
		}
		defer reference.Remove()
		actual, err := w.Compile(t.Context(), Single(prefix+vibe))
		if err != nil {
			t.Fatal(err)
		}
		defer actual.Remove()
		want := map[int32]bool{}
		got := map[int32]bool{}
		for _, diag := range reference.Diagnostics {
			if diag.Category() == diagnostics.CategoryError {
				want[diag.Code()] = true
			}
		}
		// Only a direct Effect body gets EK0102; a nested native async callable owns its await.
		if d.key == "effect-async-dual" || d.key == "effect-async-pure-stream" {
			want[102] = true
		}
		for _, diag := range actual.Diagnostics {
			if diag.Category() == diagnostics.CategoryError {
				got[diag.Code()] = true
			}
		}
		keys := func(m map[int32]bool) []int32 {
			var a []int32
			for c := range m {
				a = append(a, c)
			}
			sort.Slice(a, func(i, j int) bool { return a[i] < a[j] })
			return a
		}
		if !slices.Equal(keys(want), keys(got)) {
			Gap(t, nativeStreamProtocolTarget, key, "native TypeScript protocol/placement mismatch: want%v got%v; %v; source=%s", keys(want), keys(got), Keys(actual.Dir, actual.Diagnostics), vibe)
			return
		}
		ExpectPending(t, nativeStreamProtocolTarget, key)
		ExpectPending(t, nativeStreamProtocolTarget, specCorpusKey(t))
	})
}
