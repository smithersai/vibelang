import { expect, test } from "bun:test"
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import * as NodeServices from "@effect/platform-node/NodeServices"
import { ConfigProvider, Effect, FileSystem, Layer } from "effect"
import { Agent } from "vibelang-runtime/experimental"

// Experimental.Agent.detect (VIP-63 rule 9) reports which coding-agent CLIs a
// machine has. The machine here is a temporary home directory with real
// executables that print a version, the host's variables are an injected
// Config, and the file system is Node's, wrapped to record every file whose
// contents are read.

const secret = "sk-secret-do-not-read"

interface Machine {
  readonly home: string
  readonly env: Record<string, string>
}

const machine = (setup: {
  readonly clis?: Record<string, string>
  readonly files?: Record<string, string>
  readonly env?: Record<string, string>
}): Machine => {
  const home = mkdtempSync(join(tmpdir(), "vibelang-agent-detect-"))
  const bin = join(home, "tools", "bin")
  mkdirSync(bin, { recursive: true })
  for (const [name, script] of Object.entries(setup.clis ?? {})) {
    writeFileSync(join(bin, name), `#!/bin/sh\n${script}\n`)
    chmodSync(join(bin, name), 0o755)
  }
  for (const [name, content] of Object.entries(setup.files ?? {})) {
    mkdirSync(join(home, name, ".."), { recursive: true })
    writeFileSync(join(home, name), content)
  }
  return { home, env: { HOME: home, PATH: `${bin}:relative/bin:/usr/bin:/bin`, ...setup.env } }
}

// Node's file system, recording each path whose contents are read. It shows
// nothing outside the temporary home, so a CLI installed on the machine that
// runs this test is not part of the machine under test.
const recording = (read: Array<string>, home: string) =>
  Layer.effect(
    FileSystem.FileSystem,
    Effect.map(FileSystem.FileSystem, (fs) => ({
      ...fs,
      stat: (path: string) => fs.stat(path.startsWith(home) ? path : join(home, "outside-the-machine")),
      readFile: (path: string) => {
        read.push(path)
        return fs.readFile(path)
      },
      readFileString: (path: string, encoding?: string) => {
        read.push(path)
        return fs.readFileString(path, encoding)
      },
      open: (path: string, options?: never) => {
        read.push(path)
        return fs.open(path, options)
      },
      stream: (path: string, options?: never) => {
        read.push(path)
        return fs.stream(path, options)
      }
    }))
  ).pipe(Layer.provide(NodeServices.layer))

const detect = (on: Machine, read: Array<string> = []) =>
  Effect.runPromise(
    Agent.detect().pipe(
      Effect.provide(Layer.mergeAll(
        Layer.provideMerge(recording(read, on.home), NodeServices.layer),
        ConfigProvider.layer(ConfigProvider.fromEnvRecord(on.env))
      ))
    ) as Effect.Effect<ReadonlyArray<Agent.DetectedCli>>
  )

const byId = (found: ReadonlyArray<Agent.DetectedCli>) => Object.fromEntries(found.map((cli) => [cli.id, cli]))

test("detect reports each CLI's binary, version and standing", async () => {
  const on = machine({
    clis: {
      claude: `echo "2.1.4 (Claude Code)"`,
      codex: `printf '\\033[1mcodex-cli\\033[0m 0.159.0\\n'`
    },
    files: {
      ".claude.json": JSON.stringify({ oauthAccount: { emailAddress: "ada@example.com", organizationName: "Analytical Engines" } }),
      ".codex/auth.json": JSON.stringify({ tokens: { access_token: secret } })
    }
  })
  try {
    const found = await detect(on)
    expect(found.map((cli) => cli.id)).toEqual(["claude", "codex", "opencode"])
    expect(byId(found)).toEqual({
      claude: {
        id: "claude",
        name: "Claude Code",
        binary: join(on.home, "tools", "bin", "claude"),
        version: "2.1.4",
        status: "signed-in",
        account: { email: "ada@example.com", label: "Analytical Engines" }
      },
      codex: {
        id: "codex",
        name: "Codex",
        binary: join(on.home, "tools", "bin", "codex"),
        version: "0.159.0",
        status: "signed-in",
        account: undefined
      },
      opencode: { id: "opencode", name: "OpenCode", binary: undefined, version: undefined, status: "unavailable", account: undefined }
    })
  } finally {
    rmSync(on.home, { recursive: true, force: true })
  }
})

test("rule 9: detect reads no token: a credential file is checked for, never opened, and a key is named, never returned", async () => {
  const on = machine({
    clis: { claude: `echo 2.1.4`, codex: `echo 0.159.0`, opencode: `echo 1.4.2` },
    files: {
      ".claude/.credentials.json": JSON.stringify({ accessToken: secret }),
      ".codex/auth.json": JSON.stringify({ tokens: { access_token: secret, id_token: secret } }),
      ".local/share/opencode/auth.json": JSON.stringify({ anthropic: { key: secret } })
    },
    env: { ANTHROPIC_API_KEY: secret, OPENAI_API_KEY: secret }
  })
  try {
    const read: Array<string> = []
    const found = await detect(on, read)
    expect(found.map((cli) => [cli.id, cli.status, cli.account])).toEqual([
      ["claude", "signed-in", undefined],
      ["codex", "signed-in", undefined],
      ["opencode", "signed-in", undefined]
    ])
    // The only file read is the state file that would name the account; it is absent here.
    expect(read).toEqual([join(on.home, ".claude.json")])
    expect(JSON.stringify(found)).not.toContain(secret)
  } finally {
    rmSync(on.home, { recursive: true, force: true })
  }
})

test("a key variable that is set is reported by name; with nothing, the CLI is binary-only", async () => {
  const on = machine({
    clis: { claude: `echo 2.1.4`, codex: `echo 0.159.0`, opencode: `echo 1.4.2` },
    env: { OPENAI_API_KEY: secret, GEMINI_API_KEY: secret, ANTHROPIC_API_KEY: "" }
  })
  try {
    const found = await detect(on)
    expect(found.map((cli) => [cli.id, cli.status, cli.account])).toEqual([
      ["claude", "binary-only", undefined],
      ["codex", "api-key", { label: "OPENAI_API_KEY" }],
      ["opencode", "api-key", { label: "OPENAI_API_KEY" }]
    ])
    expect(JSON.stringify(found)).not.toContain(secret)
  } finally {
    rmSync(on.home, { recursive: true, force: true })
  }
})

test("the version probe runs with no key in its environment", async () => {
  const on = machine({
    clis: { codex: `echo "9.9.9-\${OPENAI_API_KEY:-nokey}-\${NO_COLOR}"` },
    env: { OPENAI_API_KEY: secret }
  })
  try {
    const found = await detect(on)
    expect(byId(found).codex).toMatchObject({ version: "9.9.9-nokey-1", status: "api-key" })
  } finally {
    rmSync(on.home, { recursive: true, force: true })
  }
})

test("a failed version probe discards its output and keeps the installed binary", async () => {
  const on = machine({ clis: { codex: `echo "setup requires 9.8.7"; exit 2` } })
  try {
    const { codex } = byId(await detect(on))
    expect(codex).toMatchObject({ binary: join(on.home, "tools", "bin", "codex"), version: undefined, status: "binary-only" })
  } finally {
    rmSync(on.home, { recursive: true, force: true })
  }
})

test("a CLI that prints nothing, fails or hangs has no version, and detect still answers", async () => {
  const on = machine({
    clis: { claude: `exit 3`, codex: `sleep 30`, opencode: `echo; echo "  opencode v1.4.2-beta+7  "; echo later` }
  })
  try {
    const started = Date.now()
    const found = await detect(on)
    expect(found.map((cli) => [cli.id, cli.version, cli.status])).toEqual([
      ["claude", undefined, "binary-only"],
      ["codex", undefined, "binary-only"],
      ["opencode", "1.4.2-beta+7", "binary-only"]
    ])
    expect(Date.now() - started).toBeLessThan(10_000)
  } finally {
    rmSync(on.home, { recursive: true, force: true })
  }
}, 20_000)

test("a binary is found in the usual install directories, the newest nvm Node first, and a directory is not a binary", async () => {
  const on = machine({})
  try {
    for (const version of ["v20.1.0", "v22.11.0", "v9.0.0"]) {
      const bin = join(on.home, ".nvm", "versions", "node", version, "bin")
      mkdirSync(bin, { recursive: true })
      writeFileSync(join(bin, "codex"), `#!/bin/sh\necho ${version}\n`)
      chmodSync(join(bin, "codex"), 0o755)
    }
    mkdirSync(join(on.home, ".opencode", "bin"), { recursive: true })
    writeFileSync(join(on.home, ".opencode", "bin", "opencode"), `#!/bin/sh\necho 1.0.0\n`)
    chmodSync(join(on.home, ".opencode", "bin", "opencode"), 0o755)
    mkdirSync(join(on.home, ".local", "bin", "claude"), { recursive: true })
    const found = byId(await detect(on))
    expect(found.codex).toMatchObject({ binary: join(on.home, ".nvm", "versions", "node", "v22.11.0", "bin", "codex"), version: "22.11.0" })
    expect(found.opencode).toMatchObject({ binary: join(on.home, ".opencode", "bin", "opencode"), version: "1.0.0" })
    expect(found.claude).toMatchObject({ binary: undefined, status: "unavailable" })
  } finally {
    rmSync(on.home, { recursive: true, force: true })
  }
})

test("a custom config directory is honored, and a broken state file is not a sign-in", async () => {
  const on = machine({
    clis: { claude: `echo 2.1.4`, codex: `echo 0.159.0` },
    files: {
      ".claude.json": "{ not json",
      "elsewhere/codex/auth.json": "{}"
    }
  })
  try {
    const found = byId(await detect({ ...on, env: { ...on.env, CODEX_HOME: join(on.home, "elsewhere", "codex") } }))
    expect(found.claude).toMatchObject({ status: "binary-only", account: undefined })
    expect(found.codex).toMatchObject({ status: "signed-in" })
  } finally {
    rmSync(on.home, { recursive: true, force: true })
  }
})
