import { Effect } from "effect"
function boolean(s: string) { return /ab/.test(s) ? 1 : 0 }
function extract(s: string) { const m = /(a)(b)/[Symbol.match](s); return m ? m[0] + ":" + m[1] + ":" + m[2] : "" }
export function main() {
  return Effect.gen(function* () { return [boolean("ab"), boolean("cd"), extract("ab"), extract("cd")] 
  })
}
