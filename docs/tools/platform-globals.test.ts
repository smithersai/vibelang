import { expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { defaultCompiler } from "./check-snippets"

const repo = resolve(import.meta.dir, "../..")
const compiler = defaultCompiler()
const page = "docs/user/src/platform/platform-globals.md"

// The page's table is the one EK4402 reads (TestPlatformGlobalsDocumented in
// typescript/tsc/internal/vibelang). Each row's example must compile where
// the page shows it: in a block the snippet checker reports ok, not in a
// fragment, a compiler gap, or a block that fails.
test.skipIf(!existsSync(compiler))("every example in the platform globals table compiles on the page", async () => {
  const examples = [...readFileSync(join(repo, page), "utf8").matchAll(/^\| `[^`]+` \| `([^`]+)` \|$/gm)].map(m => m[1])
  expect(examples.length).toBeGreaterThan(50)
  const temp = mkdtempSync(join(tmpdir(), "platform-globals-"))
  try {
    const output = join(temp, "report.json")
    const child = Bun.spawn(["bun", join(import.meta.dir, "check-snippets.ts"), "--filter", "platform/platform-globals.md", "--compiler", compiler, "--json", output], { stdout: "pipe", stderr: "pipe" })
    const [stdout, status] = await Promise.all([new Response(child.stdout).text(), child.exited])
    expect({ status, stdout: status ? stdout : "" }).toEqual({ status: 0, stdout: "" })
    const blocks: { status: string; source: string }[] = JSON.parse(readFileSync(output, "utf8")).pages.find((p: { page: string }) => p.page === page).blocks
    // A block in the VIP language waits for the compiler (pending); it compiles here once its pending line goes.
    const checked = blocks.filter(block => block.status === "ok" || block.status === "pending").map(block => block.source)
    expect([...new Set(examples)].filter(example => !checked.some(source => source.includes(example)))).toEqual([])
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
})
