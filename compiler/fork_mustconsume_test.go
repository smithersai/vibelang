package compiler

import (
	"strings"
	"testing"
)

func TestPinnedForkBoundAndUnboundMustConsume(t *testing.T) {
	t.Run("bound Promise charges the binding while chaining remains separately forbidden", func(t *testing.T) {
		authored := `export class Missing extends Error {
  constructor(readonly key: string) { super(key) }
}

async function lookup(key: string): Promise<Result<string, Missing>> {
  if (key !== "ada") throw new Missing(key)
  return "Ada Lovelace"
}

export async function main(): Promise<string[]> {
  const started = lookup("ada")
  const outcome = await started.then((settled) => settled)
  return [outcome.unwrapOr("Guest")]
}
`
		files := []SourceFile{{Path: "main.sm", Kind: FileKindSmithers, Text: authored}}
		result := compileInternalSource(t, files)
		got := strings.Join(formatDiagnosticPositions(t, files, result), " ")
		if got != "SMITHERS1401@12:25 SMITHERS1403@11:9" {
			t.Fatalf("bound Promise diagnostics = %s, want 1401 at the chain and 1403 at the binding; raw %#v", got, result.Diagnostics)
		}
	})

	t.Run("direct producer retains the unbound diagnostic", func(t *testing.T) {
		authored := `async function load(): Promise<string> { return "ada" }
export async function main(): Promise<string[]> {
  const value = await load().then((name) => name)
  return [value]
}
`
		files := []SourceFile{{Path: "main.sm", Kind: FileKindSmithers, Text: authored}}
		result := compileInternalSource(t, files)
		got := strings.Join(formatDiagnosticPositions(t, files, result), " ")
		if got != "SMITHERS1401@3:23 SMITHERS1402@3:23" {
			t.Fatalf("direct Promise diagnostics = %s, want unbound 1402; raw %#v", got, result.Diagnostics)
		}
	})

	t.Run("same-spelled shadow bindings keep independent ownership", func(t *testing.T) {
		authored := `async function load(): Promise<string> { return "ada" }
export async function main(): Promise<string[]> {
  const started = load()
  {
    const started = load()
    await started
  }
  return ["done"]
}
`
		files := []SourceFile{{Path: "main.sm", Kind: FileKindSmithers, Text: authored}}
		result := compileInternalSource(t, files)
		got := strings.Join(formatDiagnosticPositions(t, files, result), " ")
		if got != "SMITHERS1403@3:9" {
			t.Fatalf("shadowed Promise ownership = %s, want only the outer resolved symbol; raw %#v", got, result.Diagnostics)
		}
	})

	t.Run("a bound Result uses the binding diagnostic", func(t *testing.T) {
		authored := `export class Missing extends Error { }
function lookup(): Result<string, Missing> { return "ada" }
export function main(): string[] {
  const outcome = lookup()
  return ["done"]
}
`
		files := []SourceFile{{Path: "main.sm", Kind: FileKindSmithers, Text: authored}}
		result := compileInternalSource(t, files)
		got := strings.Join(formatDiagnosticPositions(t, files, result), " ")
		if got != "SMITHERS1302@4:9" {
			t.Fatalf("bound Result ownership = %s, want 1302 at the binding; raw %#v", got, result.Diagnostics)
		}
	})

	t.Run("compiler-owned Result inspection consumes the binding", func(t *testing.T) {
		result := compileInternalSource(t, []SourceFile{{
			Path: "main.sm", Kind: FileKindSmithers,
			Text: `class Broken extends Error {}
function load(): Result<number, Broken> {
    throw new Broken()
}
function inspect(): boolean {
    const outcome = load()
    return outcome.ok
}
`,
		}})
		requireCleanCompile(t, result)
	})
}
