package compiler

import (
	"os/exec"
	"strings"
	"testing"
)

func TestPinnedForkRuntimeFactory(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	assembler := backend.(RuntimeFactoryAssembler)
	for _, tc := range []struct{ name, source, invocation string }{
		{"plain arrow", `export const entry = (n: number) => n + 1`, "fn(41)"},
		{"function", `export function entry(n: number): number { return n + 1 }`, "fn(41)"},
		{"named runtime import", `import { inc as next } from "runtime:abi"; export const entry = (n: number) => next(n)`, "fn(41)"},
		{"quoted runtime import", `import { "inc-key" as next } from "runtime:abi"; export const entry = (n: number) => next(n)`, "fn(41)"},
		{"runtime parameter collision", `const __runtime = 41; export const entry = (n: number) => __runtime + n`, "fn(1)"},
		{"multiple runtime parameter collisions", `import { inc } from "runtime:abi"; const __runtime = 40, __runtime_1 = 1; export const entry = () => inc(__runtime + __runtime_1)`, "fn()"},
		{"escaped binding collision", `const \u005f_runtime = 41; export const entry = (n: number) => __runtime + n`, "fn(1)"},
		{"default expression preserves initialization", `const log: number[] = []; log.push(1); export default log.push(40); log.push(1); export const entry = () => log.reduce((a, b) => a + b, 0)`, "fn()"},
		{"default anonymous class name", `const names: string[] = []; export default class { static value = names.push(this.name) }; export const entry = () => names[0] === "default" ? 42 : 0`, "fn()"},
		{"default class expression name", `const names: string[] = []; export default (class { static value = names.push(this.name) }); export const entry = () => names[0] === "default" ? 42 : 0`, "fn()"},
		{"named default class local identity", `export default class Named { static value = Named.name }; export const entry = () => Named.value === "Named" ? 42 : 0`, "fn()"},
		{"anonymous default function", `export default function() { return 1 }; export const entry = () => 42`, "fn()"},
		{"named default function", `export default function named(n: number) { return n + 1 }; export const entry = (n: number) => named(n)`, "fn(41)"},
		{"local export specifier", `const entry = () => 42; export { entry as other }`, "fn()"},
		{"type-only imports", `import type { Unavailable } from "missing"; export const entry = (n: number) => n + 1`, "fn(41)"},
		{"async body", `export async function entry(n: number) { return (await Promise.resolve(n)) + 1 }`, "fn(41)"},
		{"generator body", `export function* entry(n: number) { yield n; return n + 1 }`, "(() => { const it = fn(41); it.next(); return it.next().value })()"},
		{"async generator body", `export async function* entry(n: number) { yield await Promise.resolve(n); return n + 1 }`, "(async () => { const it = fn(41); await it.next(); return (await it.next()).value })()"},
		{"lexical async computed key", `export async function entry() { const obj = { [await Promise.resolve("value")]() { return 42 } }; return obj.value() }`, "fn()"},
		{"Unicode and literal bytes", `const 計算 = (n: number) => n + 1; const data = "\ud800"; export const entry = (n: number) => data.charCodeAt(0) === 0xd800 ? 計算(n) : 0`, "fn(41)"},
		{"mutual recursion", `function first(n: number): number { return n ? second(n-1) : 42 }; function second(n: number): number { return first(n) }; export const entry = first`, "fn(3)"},
		{"destructured entry", `export const { entry } = { entry: () => 42 }`, "fn()"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := assembler.RuntimeFactory(ctx, RuntimeFactoryRequest{Source: tc.source, Entry: "entry", RuntimeSpecifier: "runtime:abi"})
			if err != nil || !got.OK || got.Code == "" || got.Message != "" {
				t.Fatalf("got=%+v err=%v", got, err)
			}
			command := exec.CommandContext(ctx, "node", "--input-type=module")
			command.Stdin = strings.NewReader(`const factory = (` + got.Code + `); const fn = factory({inc: n => n + 1, "inc-key": n => n + 1}); console.log(await (` + tc.invocation + `));`)
			output, err := command.CombinedOutput()
			if err != nil || strings.TrimSpace(string(output)) != "42" {
				t.Fatalf("output=%q err=%v\n%s", output, err, got.Code)
			}
		})
	}
	for _, tc := range []struct{ name, source, entry string }{
		{"missing entry", `const present = () => 42`, "entry"},
		{"type-only entry", `type entry = number`, "entry"},
		{"ambient entry", `declare const entry: () => number`, "entry"},
		{"empty entry", `const entry = () => 42`, ""},
		{"entry injection", `const entry = () => 42`, "entry); sideEffect(); (entry"},
		{"entry keyword", `const entry = () => 42`, "await"},
		{"invalid syntax", `export const entry = () => { return + }`, "entry"},
		{"unbound runtime import", `import { inc } from "missing"; export const entry = () => inc(41)`, "entry"},
		{"bare runtime import", `import "runtime:abi"; export const entry = () => 42`, "entry"},
		{"runtime namespace", `import * as ABI from "runtime:abi"; export const entry = () => ABI.inc(41)`, "entry"},
		{"runtime default import", `import ABI from "runtime:abi"; export const entry = () => ABI.inc(41)`, "entry"},
		{"runtime attributes", `import { inc } from "runtime:abi" with { type: "json" }; export const entry = () => inc(41)`, "entry"},
		{"re-export", `export { value } from "missing"; export const entry = () => 42`, "entry"},
		{"import equals", `import ABI = require("runtime:abi"); const entry = () => ABI.inc(41)`, "entry"},
		{"export equals", `const entry = () => 42; export = entry`, "entry"},
		{"dynamic import", `export const entry = () => import("missing")`, "entry"},
		{"module metadata", `export const entry = () => import.meta.url`, "entry"},
		{"top-level await", `const value = await Promise.resolve(42); export const entry = () => value`, "entry"},
		{"await computed module key", `const value = { [await Promise.resolve("key")]: 42 }; export const entry = () => value.key`, "entry"},
		{"await computed method name", `const value = { [await Promise.resolve("key")]() { return 42 } }; export const entry = () => value.key()`, "entry"},
		{"top-level for-await", `for await (const item of []) {} export const entry = () => 42`, "entry"},
		{"top-level return", `return 1; export const entry = () => 42`, "entry"},
		{"duplicate binding", `const entry = () => 1; const entry = () => 42`, "entry"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := assembler.RuntimeFactory(ctx, RuntimeFactoryRequest{Source: tc.source, Entry: tc.entry, RuntimeSpecifier: "runtime:abi"})
			if err != nil || got.OK || got.Code != "" || got.Message == "" {
				t.Fatalf("got=%+v err=%v", got, err)
			}
		})
	}
	t.Run("bounds", func(t *testing.T) {
		for _, request := range []RuntimeFactoryRequest{
			{Source: strings.Repeat(" ", 4*1024*1024+1), Entry: "entry", RuntimeSpecifier: "runtime:abi"},
			{Source: "const entry = () => 42", Entry: strings.Repeat("x", 2049), RuntimeSpecifier: "runtime:abi"},
			{Source: "const entry = () => 42", Entry: "entry", RuntimeSpecifier: ""},
		} {
			if got, err := assembler.RuntimeFactory(ctx, request); err == nil {
				t.Fatalf("unbounded request: %+v", got)
			}
		}
	})
}
