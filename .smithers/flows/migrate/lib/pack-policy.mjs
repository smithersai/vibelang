import { testPath } from "./test-files.mjs"
import { ownedPaths, packageManager, repositoryPackages } from "./wire.mjs"
import { must, quote, run, writeJson } from "./util.mjs"
import { compareApiIdentity } from "./api-identity.mjs"
import { posix, resolve } from "node:path"
import { mkdtempSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
// Export routing and packing must describe the same public runtime tree.
// Keep receipts outside js/: only js/ (including its loader records) is public.
import { createHash } from "node:crypto"
import { gunzipSync } from "node:zlib"
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs"
import { dirname, join, relative, sep } from "node:path"

const receiptPath=".vibelang/pack-policy.json"
const publicDir=".vibelang/js"
const start="# BEGIN VibeLang emitted runtime packing"
const end="# END VibeLang emitted runtime packing"
const digest=text=>createHash("sha256").update(text).digest("hex")
const textAt=file=>existsSync(file)?readFileSync(file,"utf8"):undefined
const routed=value=>typeof value==="string"?value.startsWith("./.vibelang/js/"):Array.isArray(value)?value.some(routed):!!value&&typeof value==="object"&&Object.entries(value).some(([key,item])=>!["types","typings","vibelang-source"].includes(key)&&routed(item))

export function syncPackPolicy(root,pkg) {
  const path=join(root,receiptPath)
  const receipt=existsSync(path)?JSON.parse(readFileSync(path,"utf8")):{version:1,files:[],ignores:[]}
  let changed=false
  const files=()=>["package.json",receiptPath,...receipt.ignores.map(item=>item.path)]
  if(!routed(pkg.exports)&&!routed(pkg.imports)){
    if(!existsSync(path))return {changed:false,files:[]}
    if(Array.isArray(pkg.files))pkg.files=pkg.files.filter(file=>!receipt.files.includes(file))
    for(const item of receipt.ignores){
      const file=join(root,item.path),text=textAt(file)
      if(text===undefined)continue
      if(item.created&&digest(text)===item.hash)unlinkSync(file)
      else if(text.includes(item.block))writeFileSync(file,text.replace(item.block,""))
    }
    unlinkSync(path)
    return {changed:true,files:files()}
  }
  if(Array.isArray(pkg.files)&&!pkg.files.includes(publicDir)){
    pkg.files.push(publicDir)
    if(!receipt.files.includes(publicDir))receipt.files.push(publicDir)
    changed=true
  }
  const allow=(directory,rules,required=false)=>{
    const file=join(directory,".npmignore")
    const current=textAt(file)
    const git=textAt(join(directory,".gitignore"))
    if(!required&&current===undefined&&git===undefined)return
    const block="\n"+start+"\n"+rules+"\n"+end+"\n"
    if(current?.includes(block))return
    // npm uses .gitignore only while .npmignore is absent. Preserve those
    // exclusions when creating the latter; never replace them with an empty file.
    const next=(current??git??"")+block
    mkdirSync(directory,{recursive:true})
    writeFileSync(file,next)
    receipt.ignores.push({path:relative(root,file).split(sep).join("/"),block,created:current===undefined,hash:digest(next)})
    changed=true
  }
  // A files allowlist overrides the root ignore file, but not nested ignores.
  // Without one, reopen only js/ and keep sibling private caches excluded.
  if(!Array.isArray(pkg.files))allow(root,"!/.vibelang/\n/.vibelang/*\n!/.vibelang/js/\n!/.vibelang/js/**",true)
  allow(join(root,".vibelang"),"!/js/\n!/js/**")
  const walk=directory=>{
    if(!existsSync(directory))return
    allow(directory,"!/**")
    for(const item of readdirSync(directory,{withFileTypes:true}))if(item.isDirectory())walk(join(directory,item.name))
  }
  walk(join(root,publicDir))
  if(changed){
    mkdirSync(dirname(path),{recursive:true})
    writeFileSync(path,JSON.stringify(receipt,null,2)+"\n")
  }
  return {changed,files:existsSync(path)?files():[]}
}

// A later emit can first create policy files, or remove them during restore.
// Keep their ownership in the durable batch journal across every emit phase.
export function withPackingScope(codemod, emitted = []) {
  if (!codemod) return codemod
  const files = new Set(codemod.packingFiles ?? [])
  const generated = new Map((codemod.emittedJs ?? []).flatMap(row => row.generatedFiles ?? []).map(proof => [proof.file, proof]))
  for (const proof of codemod.generatedFiles ?? []) generated.set(proof.file, proof)
  for (const row of [...(codemod.emittedJs ?? []), ...emitted]) {
    for (const file of row.packingFiles ?? []) files.add(file)
  }
  for (const row of emitted) for (const proof of row.generatedFiles ?? []) generated.set(proof.file, proof)
  if (!files.size && !generated.size && !Object.hasOwn(codemod, "packingFiles")) return codemod
  return { ...codemod, packingFiles: [...files].sort(), ...(generated.size ? { generatedFiles: [...generated.values()] } : {}) }
}

// VIP-27: sidecars serve tools working on source; packages publish ordinary
// declarations. Keep exclusion independent of emitted-runtime routing.
export const isSidecar = file => /\.d\.vibex?\.ts$/.test(file)
const sidecarExclusions = ["!**/*.d.vibe.ts", "!**/*.d.vibex.ts"]

export function excludeSidecars(root, pkg) {
  const changed = []
  for (const files of [pkg.files, pkg.publishConfig?.files].filter(Array.isArray)) {
    const added = sidecarExclusions.filter(pattern => !files.includes(pattern))
    files.push(...added)
    if (added.length && !changed.includes("package.json")) changed.push("package.json")
  }
  if (Array.isArray(pkg.files)) return changed
  // Creating .npmignore disables the .gitignore fallback: retain its contents.
  const path = join(root, ".npmignore")
  const before = textAt(path)
  let text = before ?? textAt(join(root, ".gitignore")) ?? ""
  for (const pattern of sidecarExclusions.map(value => value.slice(1))) {
    if (!text.split(/\r?\n/).includes(pattern)) text += (text && !text.endsWith("\n") ? "\n" : "") + pattern + "\n"
  }
  if (text === before) return changed
  writeFileSync(path, text)
  return [...changed, ".npmignore"]
}

/**
 * Extracts each export subpath's ordered condition keys and flags any published
 * `vibelang-source` condition or `.vibe`/`.vibex` target (#410).
 */
export function exportConditionSurface(manifest) {
  const raw = manifest?.publishConfig?.exports ?? manifest?.exports
  const exportConditions = {}
  const sourceConditions = []
  if (raw === undefined || raw === null) return { exportConditions, sourceConditions }
  const map = typeof raw === "object" && !Array.isArray(raw) && Object.keys(raw).some(key => key.startsWith("."))
    ? raw
    : { ".": raw }
  const collectKeys = (value, subpath, trail) => {
    if (typeof value === "string") {
      if (/\.vibex?$/.test(value)) sourceConditions.push({ subpath, path: trail, target: value, reason: "published export targets native .vibe source" })
      return []
    }
    if (Array.isArray(value)) return value.flatMap((item, idx) => collectKeys(item, subpath, [...trail, `[${idx}]`]))
    if (!value || typeof value !== "object") return []
    const keys = []
    for (const [key, child] of Object.entries(value)) {
      keys.push(key)
      if (key === "vibelang-source") {
        sourceConditions.push({ subpath, path: [...trail, key], target: typeof child === "string" ? child : null, reason: "published export adds vibelang-source condition" })
      }
      collectKeys(child, subpath, [...trail, key])
    }
    return keys
  }
  for (const [subpath, value] of Object.entries(map)) {
    exportConditions[subpath] = collectKeys(value, subpath, [])
  }
  return { exportConditions, sourceConditions }
}

/** Strict file-list and export-map contract gate: only recorded source renames are allowed. */
export function comparePacks(baseline, candidate, migrated = {}) {
  if (!baseline?.packages || !candidate?.packages) return { ok: false, reason: "missing upstream pack baseline; rerun upgrade-effect", packages: {} }
  const packages = {}
  const excluded = baseline.skipped ?? {}
  for (const dir of new Set([...Object.keys(baseline.packages), ...Object.keys(candidate.packages)])) {
    if (!Object.hasOwn(baseline.packages, dir) && excluded[dir]?.reason === "upstream-pack-failed") continue
    const before = baseline.packages[dir], after = candidate.packages[dir]
    if (!before || !after) { packages[dir] = { ok: false, reason: "public package set changed" }; continue }
    const original = new Set(before.files.filter(file => !isSidecar(file)))
    const renames = new Set(migrated[dir] ?? [])
    const sidecars = after.files.filter(isSidecar)
    const sidecarTargets = after.sidecarTargets ?? []
    const normalized = new Set(after.files.filter(file => !isSidecar(file)).map(file => {
      if (!renames.has(file)) return file
      const stem = file.replace(/\.vibex?$/, "")
      return [stem + ".ts", stem + ".tsx"].find(path => original.has(path) && !after.files.includes(path)) ?? file
    }))
    const missing = [...original].filter(file => !normalized.has(file)).sort()
    const extra = [...normalized].filter(file => !original.has(file)).sort()
    const baselineSourceKeys = new Set((before.sourceConditions ?? []).map(item => JSON.stringify([item.subpath, item.path])))
    const sourceConditions = (after.sourceConditions ?? []).filter(item => !baselineSourceKeys.has(JSON.stringify([item.subpath, item.path])))
    const conditionChanges = []
    if (before.exportConditions && after.exportConditions) {
      for (const subpath of new Set([...Object.keys(before.exportConditions), ...Object.keys(after.exportConditions)])) {
        const bConds = before.exportConditions[subpath] ?? null
        const aConds = after.exportConditions[subpath] ?? null
        if (JSON.stringify(bConds) !== JSON.stringify(aConds)) {
          conditionChanges.push({ subpath, before: bConds, after: aConds })
        }
      }
    }
    const reasons = []
    if (sidecars.length || sidecarTargets.length) reasons.push("declaration sidecars must not ship; point published types at built .d.ts files")
    if (sourceConditions.length || conditionChanges.length) reasons.push("published export-map conditions changed or introduced native source conditions (#410)")
    packages[dir] = {
      ok: !sidecars.length && !sidecarTargets.length && !missing.length && !extra.length && !sourceConditions.length && !conditionChanges.length,
      sidecars, sidecarTargets, missing, extra,
      ...(sourceConditions.length ? { sourceConditions } : {}),
      ...(conditionChanges.length ? { conditionChanges } : {}),
      ...(reasons.length ? { reason: reasons.join("; ") } : {})
    }
  }
  return { ok: Object.values(packages).every(item => item.ok), packages, skipped: excluded }
}

/** Pack with the repository's publication config and lifecycle. Only the original tree may establish pack exclusions. */

function parseTarSize(buf, offset) {
  const first = buf[offset]
  if ((first & 0x80) !== 0) {
    let n = 0
    for (let i = 1; i < 12; i++) n = n * 256 + buf[offset + i]
    return n
  }
  const raw = buf.subarray(offset, offset + 12).toString("ascii").replace(/\0.*$/, "").trim()
  return raw ? parseInt(raw, 8) : 0
}

function readTarEntries(archive) {
  const data = gunzipSync(readFileSync(archive))
  const entries = []
  let offset = 0
  let paxPath = null
  let gnuLongName = null
  while (offset + 512 <= data.length) {
    const header = data.subarray(offset, offset + 512)
    if (header.every(byte => byte === 0)) break
    const nameField = header.subarray(0, 100).toString("utf8").replace(/\0.*$/, "")
    const size = parseTarSize(header, 124)
    const typeflag = String.fromCharCode(header[156] || 0x30)
    const prefix = header.subarray(345, 500).toString("utf8").replace(/\0.*$/, "")
    offset += 512
    const body = data.subarray(offset, offset + size)
    offset += Math.ceil(size / 512) * 512
    if (typeflag === "L") {
      gnuLongName = body.toString("utf8").replace(/\0.*$/, "")
      continue
    }
    if (typeflag === "x") {
      const text = body.toString("utf8")
      let pos = 0
      while (pos < text.length) {
        const space = text.indexOf(" ", pos)
        if (space < 0) break
        const len = parseInt(text.slice(pos, space), 10)
        if (!Number.isFinite(len) || len <= 0) break
        const record = text.slice(space + 1, pos + len).replace(/\n$/, "")
        const eq = record.indexOf("=")
        if (eq > 0 && record.slice(0, eq) === "path") paxPath = record.slice(eq + 1)
        pos += len
      }
      continue
    }
    if (typeflag === "g") continue
    const fullName = paxPath ?? gnuLongName ?? (prefix ? `${prefix}/${nameField}` : nameField)
    paxPath = null
    gnuLongName = null
    const clean = fullName.replace(/^\.\//, "")
    if (typeflag === "1" || typeflag === "2") throw new Error("tar archive contains disallowed link entry: " + fullName)
    if (typeflag === "5" || clean.endsWith("/")) continue
    entries.push({ name: clean, body })
  }
  return entries
}

/**
 * Materializes a packed `.tgz` archive into an isolated directory outside any
 * workspace so API qualification consumes only actual packed bytes (#335).
 */
export function materializePackArchive(archive, destination) {
  const root = resolve(destination)
  mkdirSync(root, { recursive: true })
  const entries = readTarEntries(archive)
  const files = []
  for (const entry of entries) {
    const rel = entry.name.replace(/^package\//, "")
    const normalized = posix.normalize(rel)
    if (!normalized || normalized === "." || normalized.startsWith("/") || normalized === ".." || normalized.startsWith("../")) {
      throw new Error("packed archive entry escapes package root: " + entry.name)
    }
    const target = resolve(root, normalized)
    if (target !== root && !target.startsWith(root + sep)) {
      throw new Error("packed archive entry escapes destination: " + entry.name)
    }
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, entry.body)
    files.push(normalized)
  }
  const manifestFile = join(root, "package.json")
  if (!existsSync(manifestFile)) throw new Error("packed archive is missing package/package.json: " + archive)
  const manifest = JSON.parse(readFileSync(manifestFile, "utf8"))
  return { directory: root, manifest, files: files.sort() }
}

/**
 * Compares the public declaration API of two packed `.tgz` archives by
 * materializing both outside any workspace and disallowing sidecar targets or
 * out-of-archive fallback paths (#335).
 */
export function comparePackedDeclarations(ts, baselineArchive, candidateArchive, options = {}) {
  const scratch = mkdtempSync(join(tmpdir(), "vibelang-packed-api-"))
  try {
    const before = materializePackArchive(baselineArchive, join(scratch, "before"))
    const after = materializePackArchive(candidateArchive, join(scratch, "after"))
    const diagnostics = []
    const refs = value => typeof value === "string" ? [value]
      : value && typeof value === "object" ? Object.values(value).flatMap(refs) : []
    for (const [label, side] of [["baseline", before], ["candidate", after]]) {
      const manifest = { ...side.manifest, ...side.manifest.publishConfig }
      for (const field of ["types", "typings", "main", "module", "exports", "imports"]) {
        for (const target of refs(manifest[field])) {
          if (isSidecar(target)) {
            diagnostics.push({ blocking: true, side: label, diagnostic: `packed ${label} manifest references sidecar target: ${target}` })
          }
          if (target.startsWith("./") && !target.includes("*")) {
            const rel = posix.normalize(target.slice(2))
            if (rel.startsWith("../") || rel === "..") {
              diagnostics.push({ blocking: true, side: label, diagnostic: `packed ${label} manifest target escapes package root: ${target}` })
            } else if (!existsSync(join(side.directory, rel))) {
              diagnostics.push({ blocking: true, side: label, diagnostic: `packed ${label} manifest target is missing from archive (workspace fallback prohibited): ${target}` })
            }
          }
        }
      }
    }
    if (diagnostics.length) {
      return {
        identical: false,
        comparisonComplete: false,
        nameDifferences: [],
        typeDifferences: [],
        docDifferences: [],
        environmentDiagnostics: diagnostics,
        packed: { baselineFiles: before.files, candidateFiles: after.files }
      }
    }
    const result = compareApiIdentity(ts, before.directory, after.directory, options)
    return { ...result, packed: { baselineFiles: before.files, candidateFiles: after.files } }
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

export async function packRepository(config, out, { upstream = false, baseline } = {}) {
  mkdirSync(out, { recursive: true })
  const packages = {}, skipped = {}
  const save = () => writeJson(join(out, "selection.json"), { packages, skipped })
  const skip = (dir, manifest, reason) => { skipped[dir] = { name: manifest.name, ...reason }; save() }
  const manager = config.packer ?? packageManager(readdirSync(config.target))
  const owns = ownedPaths(config.target)
  save()
  for (const pkg of repositoryPackages(config.target)) {
    const root = join(config.target, pkg.dir)
    const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
    const path = posix.join(pkg.dir, "package.json")
    // Baseline success always wins over an exclusion: corrupt receipts cannot
    // turn a previously working public package into an optional check.
    if (!Object.hasOwn(baseline?.packages ?? {}, pkg.dir) && baseline?.skipped?.[pkg.dir]?.reason === "upstream-pack-failed") {
      skip(pkg.dir, manifest, { ...baseline.skipped[pkg.dir], baseline: true }); continue
    }
    const reason = !owns(path) ? "not-workspace-member" : testPath.test(path) ? "test-fixture"
      : manifest.private === true ? "private" : !manifest.name ? "missing-name" : !manifest.version ? "missing-version" : null
    if (reason) { skip(pkg.dir, manifest, { reason }); continue }
    const attempt = async (command, stage, log) => {
      const result = await run(command, { cwd: root, log: join(out, log) })
      if (result.code === 0) return true
      if (!upstream || Object.hasOwn(baseline?.packages ?? {}, pkg.dir)) {
        throw new Error(pkg.dir + ": " + stage + " failed (exit " + result.code + "); see " + join(out, log))
      }
      skip(pkg.dir, manifest, { reason: "upstream-pack-failed", stage, code: result.code, log })
      return false
    }
    const directory = mkdtempSync(join(resolve(out), "tarball-"))
    let generated
    const prior = new Map(readdirSync(root).filter(file => file.endsWith(".tgz")).map(file => [file, statSync(join(root, file)).mtimeMs]))
    try {
      // Some repositories' pack script temporarily maps exports to dist before
      // creating the archive, then restores the source manifest in finally.
      if (manifest.scripts?.pack) {
        if (!await attempt(manager + " run pack", "pack-script", "pack-script-" + encodeURIComponent(pkg.dir) + ".log")) continue
        const produced = readdirSync(root).filter(file => file.endsWith(".tgz") && prior.get(file) !== statSync(join(root, file)).mtimeMs)
        if (produced.length > 1) throw new Error("ambiguous pack script output for " + pkg.dir)
        generated = produced[0]
      }
      const command = manager === "bun" ? "bun pm pack --destination " + quote(directory)
        : manager === "yarn" ? "yarn pack --out " + quote(join(directory, "package.tgz"))
        : manager + " pack --pack-destination " + quote(directory)
      if (!generated && !await attempt(command, "pack", "pack-" + encodeURIComponent(pkg.dir) + ".log")) continue
      const archives = generated ? [generated] : readdirSync(directory).filter(file => file.endsWith(".tgz"))
      if (archives.length !== 1) throw new Error("expected one package tarball for " + pkg.dir)
      const archive = join(generated ? root : directory, archives[0])
      const entries = readTarEntries(archive)
      const files = entries.map(entry => entry.name.replace(/^package\//, "")).sort()
      const manifestEntry = entries.find(entry => entry.name === "package/package.json")
      if (!manifestEntry) throw new Error("expected package/package.json in tarball for " + pkg.dir)
      const published = JSON.parse(manifestEntry.body.toString("utf8"))
      const refs = value => typeof value === "string" ? (isSidecar(value) ? [value] : [])
        : value && typeof value === "object" ? Object.values(value).flatMap(refs) : []
      const sidecarTargets = ["types", "typings", "main", "module", "exports", "imports"].flatMap(field => refs(published[field]))
      const { exportConditions, sourceConditions } = exportConditionSurface(published)
      packages[pkg.dir] = { name: published.name, files, sidecarTargets, exportConditions, sourceConditions }
      save()
    } finally {
      if (generated && !prior.has(generated)) unlinkSync(join(root, generated))
      rmSync(directory, { recursive: true, force: true })
    }
  }
  return { packages, skipped }
}

/** Setup edits owned package policy only; fixtures and vendored manifests keep every byte. */
export function wireSidecarPacking(root) {
  const changed = [], owns = ownedPaths(root)
  for (const member of repositoryPackages(root)) {
    const path = posix.join(member.dir, "package.json")
    if (!owns(path) || testPath.test(path) || member.manifest.private === true) continue
    const edits = excludeSidecars(join(root, member.dir), member.manifest)
    if (edits.includes("package.json")) writeFileSync(join(root, path), JSON.stringify(member.manifest, null, 2) + "\n")
    changed.push(...edits.map(file => posix.join(member.dir, file)))
  }
  return changed
}
