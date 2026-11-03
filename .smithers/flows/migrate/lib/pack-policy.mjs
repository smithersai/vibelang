import { testPath } from "./test-files.mjs"
import { ownedPaths, packageManager, repositoryPackages } from "./wire.mjs"
import { must, quote } from "./util.mjs"
import { posix, resolve } from "node:path"
import { mkdtempSync, rmSync, statSync } from "node:fs"
// Export routing and packing must describe the same public runtime tree.
// Keep receipts outside js/: only js/ (including its loader records) is public.
import { createHash } from "node:crypto"
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

/** Strict file-list gate: only recorded source renames are allowed. */
export function comparePacks(baseline, candidate, migrated = {}) {
  if (!baseline?.packages || !candidate?.packages) return { ok: false, reason: "missing upstream pack baseline; rerun upgrade-effect", packages: {} }
  const packages = {}
  for (const dir of new Set([...Object.keys(baseline.packages), ...Object.keys(candidate.packages)])) {
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
    packages[dir] = { ok: !sidecars.length && !sidecarTargets.length && !missing.length && !extra.length, sidecars, sidecarTargets, missing, extra,
      ...(sidecars.length || sidecarTargets.length ? { reason: "declaration sidecars must not ship; point published types at built .d.ts files" } : {}) }
  }
  return { ok: Object.values(packages).every(item => item.ok), packages }
}

/** Pack with the repository's manager, including its publication lifecycle. */
export async function packRepository(config, out) {
  mkdirSync(out, { recursive: true })
  const packages = {}
  const manager = config.packer ?? packageManager(readdirSync(config.target))
  const owns = ownedPaths(config.target)
  for (const pkg of repositoryPackages(config.target).filter(pkg => owns(posix.join(pkg.dir, "package.json")) && !testPath.test(posix.join(pkg.dir, "package.json")))) {
    const root = join(config.target, pkg.dir)
    const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
    if (manifest.private === true) continue
    const directory = mkdtempSync(join(resolve(out), "tarball-"))
    let generated
    const prior = new Map(readdirSync(root).filter(file => file.endsWith(".tgz")).map(file => [file, statSync(join(root, file)).mtimeMs]))
    try {
      // Some repositories' pack script temporarily maps exports to dist before
      // creating the archive, then restores the source manifest in finally.
      if (manifest.scripts?.pack) {
        await must(manager + " run pack", { cwd: root, log: join(directory, "..", "pack-script-" + encodeURIComponent(pkg.dir) + ".log") })
        const produced = readdirSync(root).filter(file => file.endsWith(".tgz") && prior.get(file) !== statSync(join(root, file)).mtimeMs)
        if (produced.length > 1) throw new Error("ambiguous pack script output for " + pkg.dir)
        generated = produced[0]
      }
      const command = manager === "bun" ? "bun pm pack --destination " + quote(directory)
        : manager === "yarn" ? "yarn pack --out " + quote(join(directory, "package.tgz"))
        : manager + " pack --pack-destination " + quote(directory)
      if (!generated) await must(command, { cwd: root, log: join(directory, "..", "pack-" + encodeURIComponent(pkg.dir) + ".log") })
      const archives = generated ? [generated] : readdirSync(directory).filter(file => file.endsWith(".tgz"))
      if (archives.length !== 1) throw new Error("expected one package tarball for " + pkg.dir)
      const archive = join(generated ? root : directory, archives[0])
      const listed = await must("tar --quoting-style=literal -tzf " + quote(archive), { cwd: root })
      const files = listed.stdout.split("\n").filter(file => file && !file.endsWith("/")).map(file => file.replace(/^package\//, "")).sort()
      const packed = await must("tar -xOzf " + quote(archive) + " package/package.json", { cwd: root })
      const published = JSON.parse(packed.stdout)
      const refs = value => typeof value === "string" ? (isSidecar(value) ? [value] : [])
        : value && typeof value === "object" ? Object.values(value).flatMap(refs) : []
      const sidecarTargets = ["types", "typings", "main", "module", "exports", "imports"].flatMap(field => refs(published[field]))
      packages[pkg.dir] = { name: published.name, files, sidecarTargets }
    } finally {
      if (generated && !prior.has(generated)) unlinkSync(join(root, generated))
      rmSync(directory, { recursive: true, force: true })
    }
  }
  return { packages }
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
