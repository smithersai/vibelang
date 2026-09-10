package compiler

import (
	"strings"
	"testing"
)

func TestPinnedForkSDKLowering(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	lowerer := backend.(LanguageLowerer)
	for _, source := range []string{
		`export function main() { return 42 }`,
		`class Boom extends Error {} export function main(): Result<number, Boom> { return 42 }`,
		`class Boom extends Error {} function f(): Result<number, Boom> { throw new Boom() } export function main(): Result<number, Boom> { return f()! }`,
		`export function main(): Result<number, Panic> { return Result.try(() => 42) }`,
		`class Boom extends Error {} async function f(): Promise<Result<number, Boom>> { return 42 } export async function main(): Promise<Result<number, Boom>> { return (await f())! }`,
		`import { Context } from "vibelang/context"; import { Layer } from "vibelang/provider"; abstract class Db extends Context { abstract read(): number } function f(){return Db.context().read()} export function main(){ return Layer.provide(Layer.succeed(Db,{read:()=>42}),()=>f()) }`,
	} {
		t.Run(source, func(t *testing.T) {
			got, err := lowerer.LowerLanguage(ctx, LanguageLoweringRequest{Project: LanguageAnalysisRequest{Files: []SourceFile{{Path: "main.vibe", Kind: FileKindVibeLang, Text: source}}}, RuntimeImport: "vibelang/runtime"})
			if err != nil || !got.OK || len(got.Files) != 1 {
				t.Fatalf("%+v %v", got, err)
			}
			text := got.Files[0].Text
			if strings.Contains(text, "__vibelang_prelude") || strings.Contains(text, "new __vsResult") {
				t.Fatal(text)
			}
			if strings.Contains(source, "Result<") && (!strings.Contains(text, "ResultType") || !strings.Contains(text, "__vsResult")) {
				t.Fatal(text)
			}
			t.Log(text)
		})
	}
}

func TestPinnedForkSDKOutputAddressesAreNotSourceAuthority(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	lowerer := backend.(LanguageLowerer)
	request := LanguageLoweringRequest{
		Project:       LanguageAnalysisRequest{Files: []SourceFile{{Path: "main.vibe", Kind: FileKindVibeLang, Text: `export const value=42`}}},
		RuntimeImport: "vibelang/runtime",
		Outputs:       []LanguageLoweringOutput{{Path: "unused.ts", OutputFileName: "/output/unused.mjs"}},
	}
	got, err := lowerer.LowerLanguage(ctx, request)
	if err != nil || !got.OK || len(got.Files) != 1 || got.Files[0].Path != "main.vibe" {
		t.Fatalf("an output address must not introduce a source or artifact: %+v %v", got, err)
	}
	for _, name := range []string{"", ".", "..", "../outside.ts", "/absolute.ts", "a/../alias.ts", `a\alias.ts`, "C:/alias.ts", "bad\x00.ts"} {
		t.Run(name, func(t *testing.T) {
			request.Outputs[0].Path = name
			if _, err := lowerer.LowerLanguage(ctx, request); err == nil {
				t.Fatal("noncanonical output address was accepted")
			}
		})
	}
}
