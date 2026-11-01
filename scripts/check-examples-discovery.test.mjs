import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { delimiter, dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

const repository = process.env.VIBELANG_CHECK_EXAMPLES_ROOT ?? fileURLToPath(new URL("../", import.meta.url))
const names = ["hello", "users", "http-api", "file-tree", "resilience", "approval", "pipeline", "react-vite", "vue-vite", "svelte-vite", "foldkit-app", "alchemy-stack"]
const modes = [
  ["test-present", 0], ["test-absent", 0], ["scripts-empty", 0], ["test-fails", 1],
  ["invalid-json", 1], ["missing-manifest", 1],
  ...[1, 7, 37].flatMap(code => [["reader-exit-" + code, 1], ["reader-partial-" + code, 1], ["reader-silent-" + code, 1]])
]
for (const [mode, expected] of modes) {
  test("example checks distinguish missing tests from failed script discovery: " + mode, t => {
    const root = mkdtempSync(join(tmpdir(), "vibelang example discovery-"))
    t.after(() => rmSync(root, { recursive: true, force: true }))
    const put = (path, text) => {
      const target = join(root, path)
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, text)
      return target
    }
    const executable = (name, body) => {
      const path = put("bin/" + name, "#!/bin/sh\n" + body)
      chmodSync(path, 0o755)
      return path
    }
    mkdirSync(join(root, "scripts"), { recursive: true })
    for (const name of ["check-examples.sh", "prepare-examples.mjs"]) cpSync(join(repository, "scripts", name), join(root, "scripts", name))
    put("packages/runtime/package.json", JSON.stringify({ peerDependencies: { effect: "4.1.0" } }))
    for (const name of names) {
      const scripts = name === "users" && mode !== "test-absent" ? { scripts: mode === "scripts-empty" ? {} : { test: "fixture" } } : {}
      put("examples/" + name + "/package.json", JSON.stringify({ name, ...scripts }))
      if (name !== "http-api") put("examples/" + name + "/expected-output.txt", "fixture\n")
    }
    executable("npm", String.raw`
while [ "$1" != --pack-destination ]; do shift; done
printf fixture > "$2/runtime.tgz"
printf '%s\n' runtime.tgz
`)
    executable("bun", String.raw`
name=$(basename "$PWD")
printf '%s %s %s\n' "$name" "$1" "$2" >> "$EXAMPLE_DISCOVERY_TRACE"
if [ "$name" = users ] && [ "$1" = run ] && [ "$EXAMPLE_DISCOVERY_MODE" = test-fails ]; then exit 7; fi
exit 0
`)
    const compiler = executable("compiler", String.raw`
case $PWD in
  */users)
    case $EXAMPLE_DISCOVERY_MODE in
      invalid-json) printf '{broken' > package.json ;;
      missing-manifest) rm package.json ;;
    esac ;;
esac
mkdir -p dist
printf '%s\n' 'console.log("fixture")' > dist/main.js
`)
    // Only the manifest probe is faulted. Staging and application execution
    // use real Node; malformed and missing manifests also exercise its reader.
    executable("node", String.raw`
if [ "$1" = -e ]; then
  case $3 in
    */users/package.json)
      case $EXAMPLE_DISCOVERY_MODE in
        reader-*)
          case $EXAMPLE_DISCOVERY_MODE in *partial*) printf 'yes\n' ;; esac
          case $EXAMPLE_DISCOVERY_MODE in *silent*) ;; *) printf 'fixture: manifest reader failed\n' >&2 ;; esac
          case $EXAMPLE_DISCOVERY_MODE in *-37) exit 37 ;; *-7) exit 7 ;; *) exit 1 ;; esac ;;
      esac ;;
  esac
fi
` + "exec " + "'" + process.execPath.replaceAll("'", "'\\''") + "' " + '"$@"\n')
    const temporary = join(root, "temporary")
    mkdirSync(temporary)
    const trace = join(root, "bun.jsonl")
    const result = spawnSync("sh", [join(root, "scripts/check-examples.sh")], {
      cwd: root, encoding: "utf8", timeout: 30000,
      env: { ...process.env, PATH: join(root, "bin") + delimiter + process.env.PATH, TMPDIR: temporary,
        VIBELANG: compiler, EXAMPLE_DISCOVERY_TRACE: trace, EXAMPLE_DISCOVERY_MODE: mode }
    })
    const calls = readFileSync(trace, "utf8").trim().split("\n")
    const ranTests = calls.includes("users run test")
    assert.equal(result.status, expected, result.stdout + result.stderr)
    assert.equal(ranTests, mode === "test-present" || mode === "test-fails", "test presence must not hide discovery errors")
    assert.match(result.stdout, /OK\s+pipeline\s+compile and output/, "keep checking later examples")
    assert.match(result.stdout, /OK\s+alchemy-stack\s+bun run test/)
    assert.deepEqual(readdirSync(temporary), [], "staged examples must be cleaned")
    if (expected === 0) {
      assert.doesNotMatch(result.stdout, /^FAIL/m)
      assert.match(result.stdout, /OK\s+users\s+compile and output/)
    } else {
      assert.equal((result.stdout.match(/^FAIL/gm) ?? []).length, 1)
      assert.doesNotMatch(result.stdout, /OK\s+users\b/)
      if (mode !== "test-fails") {
        assert.match(result.stdout, /FAIL\s+users\s+test script discovery/)
        const log = readFileSync(join(root, ".cache/check-examples/users.log"), "utf8")
        assert.match(log, /check-examples: test script discovery exited /)
        assert.match(log, new RegExp("exited " + (mode.startsWith("reader-") ? mode.split("-").at(-1) : 1) + "\\n"))
        if (!mode.includes("silent")) assert.match(log, /manifest reader failed|SyntaxError|ENOENT/)
        assert.ok(!existsSync(join(root, ".cache/check-examples/users.output")), "do not run after discovery failed")
      }
    }
  })
}
