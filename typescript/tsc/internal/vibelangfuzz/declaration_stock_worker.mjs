// One pinned stock compiler, fresh program/diagnostics/emit for every request.
// A new root snapshot also discards inherited configuration state: updating
// a snapshot can retain removed options from an unchanged extends wrapper.
// The preceding snapshot lives until its successor has acquired unchanged
// parsed dependencies; no diagnostic or emitted output is reused.
import { createInterface } from "node:readline"
import { pathToFileURL } from "node:url"
import { join, resolve } from "node:path"

const [modulePath, executable] = process.argv.slice(2)
const { API, formatDiagnostics, DiagnosticCategory } = await import(pathToFileURL(modulePath))
const api = new API({ tsserverPath: executable })
let snapshot = await api.createSnapshot()
try {
  for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
    let request
    try {
      request = JSON.parse(line)
      const config = join(resolve(request.directory), "tsconfig.json")
      const next = await api.createSnapshot({
        openProjects: [config],
        fileNotifications: { invalidateAll: true },
      })
      await snapshot.dispose()
      snapshot = next
      const project = snapshot.getConfiguredProject(config)
      if (!project) throw Error("stock compiler did not load the requested project")
      const program = project.program
      const diagnostics = [
        ...await program.getConfigFileParsingDiagnostics(),
        ...await program.getSyntacticDiagnostics(),
        ...await program.getProgramDiagnostics(),
        ...await program.getGlobalDiagnostics(),
        ...await program.getSemanticDiagnostics(),
        ...await program.getDeclarationDiagnostics(),
      ]
      const emitted = await program.emit()
      diagnostics.push(...emitted.diagnostics)
      const rejected = diagnostics.some(d => d.category === DiagnosticCategory.Error)
      process.stdout.write(JSON.stringify({
        id: request.id, rejected, output: formatDiagnostics(diagnostics, program),
        emitSkipped: emitted.emitSkipped,
      }) + "\n")
    } catch (error) {
      process.stdout.write(JSON.stringify({ id: request?.id, error: String(error?.stack ?? error) }) + "\n")
    }
  }
} finally {
  await snapshot.dispose()
  await api.close()
}
