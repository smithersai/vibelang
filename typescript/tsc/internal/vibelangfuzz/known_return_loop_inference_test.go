package vibelangfuzz

import (
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const knownReturnLoopQuote = "Anything TypeScript or the pinned TC39 proposal already defines (evaluation order, binding, types, modules, resolution, declaration emit) is as in TypeScript and is not restated."

func TestKnownReturnLoopInferenceQuoted(t *testing.T) {
	if !strings.Contains(SpecText("000-intro.md"), knownReturnLoopQuote) {
		t.Fatalf("the TypeScript parity rule no longer says %q", knownReturnLoopQuote)
	}
}

func knownReturnLoopSource(key string) (string, string) {
	declaration, call, names, before := "export declare const client: { execute(text: string): Reply };", "client.execute(url.toString())", "client, header, parseUrl", ""
	switch key {
	case "computed":
		call = "client[\"execute\"](url.toString())"
	case "alias":
		before = "const send = client.execute;\n"
		call = "send(url.toString())"
	case "function":
		declaration, call, names = "export declare function send(text: string): Reply;", "send(url.toString())", "send, header, parseUrl"
	case "callable":
		declaration, call, names = "type Send = (text: string) => Reply;\nexport declare const send: Send;", "send(url.toString())", "send, header, parseUrl"
	case "provide-lookalike":
		declaration, call = "export declare const client: { provide(text: string): Reply };", "client.provide(url.toString())"
	case "factory":
		declaration += "\nexport declare function makeClient(text: string): typeof client;"
		call, names = "makeClient(\"known\").execute(url.toString())", "makeClient, header, parseUrl"
	}
	helpers := "export interface Url { readonly text: string; toString(): string }\n" +
		"export interface Reply { readonly headers: Readonly<Record<string, string | undefined>>; readonly status: number }\n" +
		"/** @throws {never} */ export declare function parseUrl(text: string, base?: Url): Url | undefined;\n" +
		"/** @throws {never} */ export declare function header(headers: Reply[\"headers\"], name: string): string | undefined;\n" + declaration + "\n"
	source := fmt.Sprintf("import { %s } from \"./helpers.js\";\n%s"+
		"export function inspect(input: string) {\n"+
		" let url = parseUrl(input);\n if (url === undefined) return \"invalid\";\n"+
		" for (let redirect = 0; redirect <= 10; redirect++) {\n"+
		"  const response = %s;\n  const location = header(response.headers, \"location\");\n"+
		"  if (response.status >= 300 && response.status < 400 && location !== undefined) {\n"+
		"   const next = parseUrl(location, url);\n   if (next === undefined) return \"invalid\";\n"+
		"   url = next;\n   continue;\n  }\n  return url.text + \":\" + response.status;\n }\n"+
		" return \"redirect-limit\";\n}\n", names, before, call)
	return source, helpers
}

// This is a static native-TypeScript/plain-VibeLang comparison under the quoted
// parity rule. The acceptance case has the same TypeScript twin, which is
// also checked with stock TypeScript.
func FuzzKnownReturnLoopInference(f *testing.F) {
	startShortBudget(f)
	keys := []string{"method", "computed", "alias", "function", "callable", "provide-lookalike", "factory", "smithers-webfetch"}
	for _, key := range keys {
		f.Add([]byte(key))
		f.Add([]byte(key + "\x00\x07"))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		TestKnownReturnLoopInferenceQuoted(t)
		parts := strings.SplitN(string(data), "\x00", 2)
		key := parts[0]
		if !slices.Contains(keys, key) {
			if len(data) == 0 {
				return
			}
			key = keys[int(data[0])%len(keys)]
		}
		source, helpers := knownReturnLoopSource(key)
		if key == "smithers-webfetch" {
			body, err := os.ReadFile(filepath.Join(repoTestdata(), "corpus", "smithers-webfetch-loop-inference.vibe"))
			if err != nil {
				t.Fatal(err)
			}
			source = string(body)
			helpers = ""
		}
		var variant byte
		if len(parts) > 1 && len(parts[1]) > 0 {
			variant = parts[1][0]
		}
		if variant&1 != 0 {
			source = strings.ReplaceAll(source, "response", "received")
		}
		if variant&2 != 0 {
			source = strings.ReplaceAll(source, "\n", "\r\n")
		}
		if variant&4 != 0 {
			source = strings.ReplaceAll(source, "export function inspect", "export async function inspect")
		}
		compile := func(extension string) []int32 {
			result, err := w.Compile(t.Context(), Project{Files: map[string]string{"main." + extension: source, "helpers.ts": helpers}})
			if err != nil {
				t.Fatal(err)
			}
			defer result.Remove()
			var codes []int32
			for _, d := range result.Diagnostics {
				if d.Category() == diagnostics.CategoryError {
					codes = append(codes, d.Code())
				}
			}
			return codes
		}
		if codes := compile("ts"); len(codes) != 0 {
			t.Fatalf("invalid TypeScript control for %s/%d: %v", key, variant&7, codes)
		}
		if codes := compile("vibe"); len(codes) != 0 {
			Gap(t, "FuzzKnownReturnLoopInference", fmt.Sprintf("inference:loop-return:%s:%d", key, variant&7),
				"ordinary calls with a known return type must retain TypeScript inference and narrowing; TypeScript has no errors, VibeLang has %v", codes)
		}
	})
}
