package compiler

import "testing"

func TestPinnedForkResultIntrospection(t *testing.T) {
	runFailClosedCases(t, []failClosedCase{
		{
			name: "compiler-owned predicates recognize real results and reject structural forgeries",
			source: `import { isResult, isPanic } from "vibelang/result";
function read(): Result<number, never> { return 2 }
export function main(): string[] {
  const result = read();
  const branded = isResult(result);
  return [String(branded) + ":" + result.unwrapOr(0), String(isResult({ isOk: () => true })), String(isPanic({ name: "Panic" }))];
}`,
			stdout: "true:2\nfalse\nfalse",
		},
		{
			name: "the predicate narrows an unknown to the actual Result surface",
			source: `import { isResult } from "vibelang/result";
function classify(value: unknown): string { return isResult(value) ? (value.isOk() ? "ok" : "error") : "plain" }
export function main(): string[] { return [classify({ isOk: () => true })] }`,
			stdout: "plain",
		},
	})
	t.Run("predicates do not expose private constructors", func(t *testing.T) {
		result := compileInternalSource(t, []SourceFile{{Path: "main.vibe", Kind: FileKindVibeLang,
			Text: `import { VibeLangOk } from "vibelang/result"; export function main(): string[] { return ["bad"] }`}})
		requireDiagnostic(t, result, "VIBE1201", "main.vibe", "compiler-owned Result constructor")
	})
}
