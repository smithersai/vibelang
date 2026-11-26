// Materialize the documentation with its own checker, then compare source
// diagnostics rather than declarations: this includes fragments and errors.
import fs from "node:fs"
import path from "node:path"
import { extract, writeProject, markdownPages, parseDiagnostics } from "../../../../docs/tools/check-snippets.ts"

type Source = { file: string; label: string; offset: number; line: number }
type Row = { file: string; line: number; column: number; code: string; message: string; origin: string }

// runDocs isolates every project under the harness package scope so dependency
// resolution cannot depend on which workspace happens to enclose the sources.
export async function runDocs(root: string, out: string, scope: string, fork: string, stock: string, mapper: string, jobs: number, fixture = false) {
  const started = performance.now()
  const base = path.join(scope, fixture ? "docs-self-test" : "docs")
  fs.rmSync(base, { recursive: true, force: true })
  fs.mkdirSync(base, { recursive: true })
  const modules = path.join(base, "node_modules")
  fs.mkdirSync(modules)
  for (const name of ["effect", "vibelang-runtime"]) fs.symlinkSync(path.join(scope, "node_modules", name), path.join(modules, name))
  fs.symlinkSync(scope, path.join(modules, "vibelang-ts-mapper"))
  const projects: { dir: string; label: string; sources: Source[]; files: string[] }[] = []
  const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name, "en")).flatMap(e => e.name.startsWith(".") || ["node_modules", "dist", "out"].includes(e.name) ? [] : e.isDirectory() ? walk(path.join(dir,e.name)) : [path.join(dir,e.name)])
  const pages = fixture ? ["self-test.md"] : markdownPages(path.join(root, "docs/user"))
  for (const page of pages) {
    const markdown = fixture ? path.join(base, page) : page
    // The planted block type-checks in the fork, but its join operand has no
    // Fiber annotation, so the mapper reports exactly one EK9005 there.
    if (fixture) fs.writeFileSync(markdown, '```vibe\nexport effect function f(fibers: Array<Fiber.Fiber<number>>) {\n  const first = fibers[0]\n  return join first\n}\n```')
    const blocks = extract(fs.readFileSync(markdown,"utf8"))
    if (!blocks.length) continue
    const dir = path.join(base, `page-${projects.length}`)
    const { filenames, offsets } = writeProject(dir, blocks)
    projects.push({ dir, label: fixture ? page : path.relative(root,page), files: [...filenames.values()], sources: blocks.filter(b => filenames.get(b.number)!.endsWith(".vibe")).map(b => ({file: filenames.get(b.number)!, label: `${fixture ? page : path.relative(root,page)}#block-${b.number}`, offset: offsets.get(filenames.get(b.number)!)!, line: b.line})) })
  }
  if (!fixture) for (const category of ["examples", "templates"]) {
    // Group by the first directory, retaining all companion sources and assets.
    const sourceRoot = path.join(root,category)
    const all = walk(sourceRoot)
    for (const name of [...new Set(all.filter(f => f.endsWith(".vibe")).map(f => path.relative(sourceRoot,f).split(path.sep)[0]))].sort()) {
      const src = path.join(sourceRoot,name)
      const single = fs.statSync(src).isFile()
      const dir = path.join(base,`${category}-${name}`)
      fs.mkdirSync(dir)
      const copied = single ? [src] : all.filter(f => f.startsWith(src + path.sep))
      for (const f of copied) { const target = path.join(dir,single ? name : path.relative(src,f)); fs.mkdirSync(path.dirname(target),{recursive:true}); fs.copyFileSync(f,target) }
      const files = copied.filter(f => /\.(vibe|tsx?|mts|cts)$/.test(f)).map(f => single ? name : path.relative(src,f))
      projects.push({dir,label:`${category}/${name}`,files,sources: copied.filter(f => f.endsWith(".vibe")).map(f => ({file: single ? name : path.relative(src,f),label:path.relative(root,f),offset:0,line:1}))})
    }
  }
  async function run(argv: string[], cwd: string) {
    const child = Bun.spawn(argv,{cwd,stdout:"pipe",stderr:"pipe"})
    const [stdout,stderr,code] = await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited])
    const output = stdout + "\n" + stderr
    if (code !== 0 && !parseDiagnostics(output).length) throw new Error(`docs: compiler failed (${code}): ${argv.join(" ")}\n${output}`)
    return output
  }
  const results: { rows: Row[]; unresolved: {project:string; diagnostics:string[]} | null }[] = []
  let next = 0
  await Promise.all(Array.from({length:Math.min(jobs,projects.length)},async () => {
    while (next < projects.length) {
      const index = next++, project = projects[index], {dir,sources,files} = project
      const mapperRows: {source:Source; line:number; column:number; code:string; message:string}[] = []
      for (const source of sources) {
        const file = path.join(dir,source.file), text = fs.readFileSync(file,"utf8")
        const projection = await run([mapper,"--print",file],dir)
        for (const m of projection.matchAll(/^\/\/ (EK\d+) at \[(\d+), \d+\): (.*)$/gm)) {
          const prefix = Buffer.from(text).subarray(0,+m[2]).toString()
          mapperRows.push({source,line:prefix.split("\n").length,column:prefix.length-prefix.lastIndexOf("\n"),code:m[1],message:m[3]})
        }
      }
      // Adapt specifiers on BOTH sides, so the fork checks identical sources.
      for (const f of files) {
        const target = path.join(dir,f), text = fs.readFileSync(target,"utf8")
        fs.writeFileSync(target,text.replace(/((?:from\s*|import\s*\(\s*)["'])(\.{1,2}\/[^"'\n]+)(["'])/g,(whole,a,b,c) => {
          const stem = b.replace(/\.m?js$/,"")
          return fs.existsSync(path.resolve(path.dirname(target),stem+".vibe")) ? a+stem+".vibe"+c : whole
        }))
      }
      const config = {compilerOptions:{strict:true,target:"ESNext",module:"NodeNext",moduleResolution:"NodeNext",skipLibCheck:true,noEmit:true,types:[],rewriteRelativeImportExtensions:true,jsx:"react-jsx"},files}
      fs.writeFileSync(path.join(dir,"fork.json"),JSON.stringify(config))
      fs.writeFileSync(path.join(dir,"stock.json"),JSON.stringify({...config,contentMappers:[{package:"vibelang-ts-mapper",extensions:[".vibe"]}]}))
      const forkOutput = await run([fork,"-p","fork.json","--pretty","false"],dir)
      const stockOutput = await run([stock,"-p","stock.json","--pretty","false","--runExternalCode"],dir)
      fs.writeFileSync(path.join(dir,"fork.log"),forkOutput)
      fs.writeFileSync(path.join(dir,"stock.log"),stockOutput)
      const fd = parseDiagnostics(forkOutput), sd = parseDiagnostics(stockOutput)
      const unresolved = [...fd,...sd].filter(d => ["TS2307","TS2688","TS6053","TS5083","TS2882","TS2875"].includes(d.diagnostic.code))
      const rows: Row[] = []
      const add = (source:Source,line:number,column:number,code:string,message:string,origin:string) => {
        if (fd.some(d => d.file && path.resolve(dir,d.file) === path.join(dir,source.file) && d.diagnostic.line === line && d.diagnostic.code === code)) return
        const row = {file:source.label,line:source.line+line-source.offset-1,column,code,message,origin}
        if (!rows.some(r => r.file===row.file && r.line===row.line && r.column===row.column && r.code===row.code && r.message===row.message)) rows.push(row)
      }
      for (const d of mapperRows) add(d.source,d.line,d.column,d.code,d.message,"mapper")
      for (const {file,diagnostic:d} of sd) {
        const source = sources.find(s => file && path.join(dir,s.file)===path.resolve(dir,file))
        if (source) add(source,d.line!,d.column!,d.code,d.message,"stock")
      }
      results[index] = {rows:unresolved.length ? [] : rows,unresolved:unresolved.length ? {project:project.label,diagnostics:[...new Set(unresolved.map(d => d.diagnostic.message))].sort()} : null}
    }
  }))
  const rows = results.flatMap(r => r.rows).sort((a,b) => a.file.localeCompare(b.file,"en") || a.line-b.line || a.column-b.column || a.code.localeCompare(b.code,"en"))
  const codes: Record<string,number> = {}
  for (const row of rows) { const code = row.message.includes("data in a run position;") ? "DataRunAnnotation" : row.code; codes[code]=(codes[code]??0)+1 }
  const summary = {modules:projects.reduce((n,p)=>n+p.sources.length,0),newDiagnostics:rows.length,affectedModules:new Set(rows.map(r=>r.file)).size,codes:Object.fromEntries(Object.entries(codes).sort()),unresolved:results.flatMap(r=>r.unresolved ? [r.unresolved] : [])}
  const line = `docs: ${summary.modules} modules, ${summary.newDiagnostics} new diagnostics in ${summary.affectedModules} modules (${Object.entries(summary.codes).map(([c,n])=>`${c} ${n}`).join(", ")}); ${summary.unresolved.length} unresolved projects excluded`
  if (!fixture) {
    fs.writeFileSync(path.join(out,"docs-unresolved.md"), "# Unresolved docs projects (excluded)\n\n" + summary.unresolved.map(p => `- ${p.project}: ${p.diagnostics.join("; ")}`).join("\n") + "\n")
    const cols = ["file","line","column","code","message","origin"] as const
    fs.writeFileSync(path.join(out,"docs-diagnostics.csv"),cols.join(",")+"\n"+rows.map(r=>cols.map(c=>'"'+String(r[c]).replaceAll('"','""')+'"').join(",")).join("\n")+"\n")
  }
  return {summary,line,seconds:(performance.now()-started)/1000,rows}
}
