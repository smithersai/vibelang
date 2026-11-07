package vibelang

import (
	"path/filepath"
	"strings"
	"testing"
)

// A call that may throw, inside a plain callback an Effect combinator runs in
// the fiber, keeps its timing and its defect: --fix wraps the callback body.
func TestFixNothrowCallbackCall(t *testing.T) {
	for _, tc := range []struct{ source, want string }{
		{"export function main(s:string):Effect.Effect<unknown> {return Effect.suspend(()=>{const v=JSON.parse(/*keep*/s);return Effect.succeed(v)})}",
			"Effect.suspend(()=>{ try {const v=JSON.parse(/*keep*/s);return Effect.succeed(v)} catch (thrown) { return die(thrown) } })"},
		{"export const main=(s:string)=>Effect.flatMap(Effect.void,()=>Effect.succeed(JSON.parse(/*keep*/s)))",
			"Effect.flatMap(Effect.void,()=>{ try { return Effect.succeed(JSON.parse(/*keep*/s)) } catch (thrown) { return die(thrown) } })"},
		{"export const main=(s:string)=>Effect.fail(1) |> Effect.catch(%,()=>Effect.succeed(JSON.parse(/*keep*/s)))",
			"Effect.catch(%,()=>{ try { return Effect.succeed(JSON.parse(/*keep*/s)) } catch (thrown) { return die(thrown) } })"},
		{"export const main=(xs:string[])=>Effect.forEach(xs,(s)=>Effect.succeed([JSON.parse(/*keep*/s), JSON.parse(s)]))",
			"Effect.forEach(xs,(s)=>{ try { return Effect.succeed([JSON.parse(/*keep*/s), JSON.parse(s)]) } catch (thrown) { return die(thrown) } })"},
		// A catchTag handler, as Alchemy's git protocol wrote it, and the
		// other handlers and finalizers Effect runs in the fiber.
		{"export const main=(s:string)=>Effect.catchTag(Effect.fail({_tag:\"Denied\"} as const),[\"Denied\"],(e)=>Effect.succeed(JSON.parse(/*keep*/s+e._tag)))",
			"[\"Denied\"],(e)=>{ try { return Effect.succeed(JSON.parse(/*keep*/s+e._tag)) } catch (thrown) { return die(thrown) } })"},
		{"export const main=(s:string)=>Effect.tapError(Effect.fail(1),()=>Effect.succeed(JSON.parse(s)))",
			"Effect.tapError(Effect.fail(1),()=>{ try { return Effect.succeed(JSON.parse(s)) } catch (thrown) { return die(thrown) } })"},
		{"export const main=(s:string)=>Effect.onExit(Effect.void,()=>Effect.succeed(JSON.parse(s)))",
			"Effect.onExit(Effect.void,()=>{ try { return Effect.succeed(JSON.parse(s)) } catch (thrown) { return die(thrown) } })"},
		{"export const main=(s:string)=>Effect.acquireRelease(Effect.succeed(s),(v)=>Effect.succeed(JSON.parse(v)))",
			"Effect.acquireRelease(Effect.succeed(s),(v)=>{ try { return Effect.succeed(JSON.parse(v)) } catch (thrown) { return die(thrown) } })"},
		// Members of a handler object Effect runs in the fiber.
		{"export const main=(s:string)=>Effect.catchTags(Effect.fail({_tag:\"Denied\"} as const),{Denied:()=>Effect.succeed(JSON.parse(s))})",
			"{Denied:()=>{ try { return Effect.succeed(JSON.parse(s)) } catch (thrown) { return die(thrown) } }}"},
		{"export const main=(s:string)=>Effect.matchEffect(Effect.succeed(s),{onFailure:()=>Effect.void,onSuccess:(v)=>Effect.succeed(JSON.parse(v))})",
			"onSuccess:(v)=>{ try { return Effect.succeed(JSON.parse(v)) } catch (thrown) { return die(thrown) } }}"},
		{"export const main=(s:string)=>Effect.whileLoop({while:()=>false,body:()=>Effect.succeed(JSON.parse(s)),step:()=>{}})",
			"body:()=>{ try { return Effect.succeed(JSON.parse(s)) } catch (thrown) { return die(thrown) } },"},
	} {
		t.Run(tc.source, func(t *testing.T) {
			_, file, _, _ := editorProgram(t, tc.source)
			r := fixCase(t, filepath.Dir(file.FileName().AsString()))
			if r.Err != nil {
				t.Fatal(r.Err)
			}
			fixed := r.Files[file.FileName()]
			if fixed == nil || !strings.Contains(fixed.Text, tc.want) || len(r.Sites) != 0 {
				t.Fatalf("missing callback defect repair, want %q: %+v", tc.want, r)
			}
		})
	}
}

// JavaScript outside the fiber can tell a throw from a returned Effect.
func TestFixNothrowCallbackCallRefusesOutsideTheFiber(t *testing.T) {
	for _, source := range []string{
		// an eager factory: its caller sees the throw
		"export function make(s:string):Effect.Effect<unknown> {return Effect.succeed(JSON.parse(s))}",
		// a callback that escapes to any caller
		"export const make=(s:string)=>{const f=():Effect.Effect<unknown>=>Effect.succeed(JSON.parse(s));return f}",
		// the callback's die is not Effect.die
		"export const main=(s:string)=>Effect.suspend(()=>{const die=(e:unknown)=>Effect.fail(e);return Effect.succeed(JSON.parse(s))})",
		// a parameter default runs at the call, outside the body
		"export const main=(s:string)=>Effect.flatMap(Effect.void,(v=JSON.parse(s))=>Effect.succeed(v))",
		// an Eager variant may call its callback while the program is built
		"export const main=(s:string)=>Effect.flatMapEager(Effect.void,()=>Effect.succeed(JSON.parse(s)))",
		"export const main=(s:string)=>Effect.matchCauseEffectEager(Effect.void,{onFailure:()=>Effect.void,onSuccess:()=>Effect.succeed(JSON.parse(s))})",
		// a handler object passed to a function that is not Effect's
		"const take=(h:{Denied:()=>Effect.Effect<unknown>})=>h\nexport const main=(s:string)=>take({Denied:()=>Effect.succeed(JSON.parse(s))})",
	} {
		t.Run(source, func(t *testing.T) {
			_, file, _, _ := editorProgram(t, source)
			r := fixCase(t, filepath.Dir(file.FileName().AsString()))
			if r.Err != nil {
				t.Fatal(r.Err)
			}
			if len(r.Sites) == 0 {
				t.Fatalf("missing refusal: %+v", r)
			}
			text := source
			if fixed := r.Files[file.FileName()]; fixed != nil {
				text = fixed.Text
			}
			if strings.Contains(text, "catch (thrown)") {
				t.Fatalf("wrapped a callback outside the fiber: %s", text)
			}
			for _, site := range r.Sites {
				if site.Code == "EK0401" && !SiteHolds(source, text, site) {
					t.Fatalf("refused site changed: %+v", site)
				}
			}
		})
	}
}
