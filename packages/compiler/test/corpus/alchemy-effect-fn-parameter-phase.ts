import { Effect } from "effect"
export const provider = {
  diff: Effect.fn(function* ({ news, output }: { news: string; output: boolean }) {
    return output ? news : undefined
  }),
}
export const initialized = Effect.fn(function* (
  { news }: { news: string },
  suffix: string = news,
) {
  return news + suffix
})
interface ProviderContract {
  diff(input: { news: string; output: boolean }): Effect.Effect<string | undefined>
}
export const contextual: ProviderContract = {
  diff: Effect.fn(function* ({ news, output }) {
    return output ? news : undefined
  }),
}
export const plain = {
  diff: ({ news, output }: { news: string; output: boolean }) => Effect.gen(function* () {
    return output ? news : undefined
  }),
}

export const withDefaults = {
 diff: Effect.fn(function* ({news,output=true}: {news:string;output?:boolean}) {
  return output ? news : undefined
 }),
}
