import { Effect } from "effect"
class ImportedWorker { constructor(readonly n:number){} }
export function main() {
 const Worker={makePool:(n:number):number=>n+1}
 return Effect.succeed([Worker.makePool(1),new ImportedWorker(2).n])
}
