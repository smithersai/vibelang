// An existing install may belong to the Effect pin from an older checkout.
import { readFileSync } from "node:fs"
import path from "node:path"

const directory = path.resolve(process.argv[2])
const manifest = JSON.parse(readFileSync(path.join(directory, "package.json"), "utf8"))
const pin = manifest.dependencies?.effect ?? manifest.devDependencies?.effect ?? manifest.peerDependencies?.effect
if (typeof pin === "string" && /^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(pin)) {
  let version
  try {
    version = JSON.parse(readFileSync(path.join(directory, "node_modules/effect/package.json"), "utf8")).version
  } catch {
    // A missing or broken install needs the same frozen install as a stale one.
  }
  if (version !== pin) process.exitCode = 1
}
