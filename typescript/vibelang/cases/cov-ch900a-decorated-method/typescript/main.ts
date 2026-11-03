import { Effect } from "effect"
function dec(_original: unknown, _context: ClassMethodDecoratorContext) {}
class C { @dec read() { return Effect.succeed(1) } }
export function main() { return Effect.gen(function* () { return yield* new C().read() }) }
