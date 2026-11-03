import { expect, test } from "bun:test"
import fc from "fast-check"
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, sep } from "node:path"

const tools = process.env.VIBELANG_SNIPPET_SELECTION_TOOLS ?? import.meta.dir

async function fixture(run: (root: string, temp: string) => Promise<void>) {
  const parent = mkdtempSync(join(tmpdir(), "snippet-selection-"))
  const root = join(parent, "pages"), temp = join(parent, "temp")
  mkdirSync(root); mkdirSync(temp)
  try { await run(root, temp) } finally { rmSync(parent, { recursive: true, force: true }) }
}

async function cli(script: string, root: string, temp: string, args: string[]) {
  const child = Bun.spawn(["bun", join(tools, script), "--root", root,
    "--compiler", join(root, "compiler-must-not-run"), ...args], {
    env: { ...process.env, TMPDIR: temp }, stdout: "pipe", stderr: "pipe"
  })
  const [stdout, stderr, status] = await Promise.all([
    new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited
  ])
  return { stdout, stderr, status }
}

for (const script of ["check-snippets.ts", "fix-snippets.ts"]) {
  test(script + " refuses an unmatched filter and preserves source and existing receipts", async () => {
    await fixture(async (root, temp) => {
      const page = join(root, "selected.md"), report = join(root, "prior.json"), pending = join(root, "prior.txt")
      const source = "# Existing page\n\nProse only.\n"
      writeFileSync(page, source)
      writeFileSync(report, "prior report\n"); writeFileSync(pending, "prior pending\n")
      const options = script === "check-snippets.ts" ? ["--json", report, "--pending-list", pending] : ["--check"]
      const output = await cli(script, root, temp, ["--filter", "misspelled-selection-145", ...options])
      expect(output.status).toBe(2)
      expect(output.stderr).toContain("No Markdown pages match")
      expect(output.stderr).toContain("misspelled-selection-145")
      expect(readFileSync(page, "utf8")).toBe(source)
      expect(readFileSync(report, "utf8")).toBe("prior report\n")
      expect(readFileSync(pending, "utf8")).toBe("prior pending\n")
      expect(readdirSync(temp)).toEqual([])
      expect(output.stdout).not.toContain("Totals:")
      expect(output.stdout).not.toContain("fix-snippets:")
    })
  })

  test(script + " refuses an empty root without invoking the compiler", async () => {
    await fixture(async (root, temp) => {
      const output = await cli(script, root, temp, [])
      expect(output.status).toBe(2)
      expect(output.stderr).toContain("No Markdown pages match")
      expect(readdirSync(temp)).toEqual([])
    })
  })

  test(script + " accepts selected prose pages and default page selection", async () => {
    await fixture(async (root, temp) => {
      mkdirSync(join(root, "nested"))
      writeFileSync(join(root, "nested", "guide.md"), "# Guide\n\nNo code here.\n")
      // Matching a page without code is intentional; it does not invoke a compiler.
      for (const args of [[], ["--filter", "nested" + sep], ["--filter", "guide.md"]]) {
        const output = await cli(script, root, temp, args)
        expect({ args, status: output.status, stderr: output.stderr }).toEqual({ args, status: 0, stderr: "" })
        expect(readdirSync(temp)).toEqual([])
      }
    })
  })

  test(script + " rejects unmatched path, case and punctuation selectors", async () => {
    await fixture(async (root, temp) => {
      writeFileSync(join(root, "guide.md"), "# Guide\n")
      for (const filter of ["absent/", "GUIDE.md", "guide.md/missing", "literal[0]", "missing#tag", "missing space"]) {
        const output = await cli(script, root, temp, ["--filter", filter])
        expect({ filter, status: output.status }).toEqual({ filter, status: 2 })
        expect(output.stderr).toContain("No Markdown pages match")
      }
    })
  })
}

test("checker rejects empty selections before receipts with jobs and retirement flags", async () => {
  await fixture(async (root, temp) => {
    writeFileSync(join(root, "guide.md"), "# Guide\n")
    const report = join(root, "prior.json"), pending = join(root, "prior.txt")
    writeFileSync(report, "prior report\n"); writeFileSync(pending, "prior pending\n")
    for (const jobs of ["1", "8"]) {
      for (const retire of [[], ["--retire-pending"]]) {
        const output = await cli("check-snippets.ts", root, temp, ["--filter", "absent-jobs-145",
          "--jobs", jobs, ...retire, "--json", report, "--pending-list", pending])
        expect(output.status).toBe(2)
        expect(output.stderr).toContain("No Markdown pages match")
        expect(readFileSync(report, "utf8")).toBe("prior report\n")
        expect(readFileSync(pending, "utf8")).toBe("prior pending\n")
        expect(readdirSync(temp)).toEqual([])
      }
    }
  })
})

test("checker retains valid selections with jobs and retirement flags", async () => {
  await fixture(async (root, temp) => {
    writeFileSync(join(root, "guide.md"), "# Guide\n")
    for (const jobs of ["1", "2", "8"]) {
      const output = await cli("check-snippets.ts", root, temp, ["--jobs", jobs, "--retire-pending", "--filter", "guide.md"])
      expect(output.status).toBe(0)
      expect(output.stderr).toBe("")
      expect(readdirSync(temp)).toEqual([])
    }
  })
})

test("generated nonmatching selectors fail before temporary staging in both commands", async () => {
  await fixture(async (root, temp) => {
    writeFileSync(join(root, "guide.md"), "# Guide\n")
    await fc.assert(fc.asyncProperty(fc.integer({ min: 0, max: 1_000_000_000 }), async suffix => {
      const filter = "absent_selection145_" + suffix
      for (const script of ["check-snippets.ts", "fix-snippets.ts"]) {
        const output = await cli(script, root, temp, ["--filter", filter])
        expect(output.status).toBe(2)
        expect(output.stderr).toContain("No Markdown pages match")
        expect(readdirSync(temp)).toEqual([])
      }
    }), { seed: 145, numRuns: 16 })
  })
})
