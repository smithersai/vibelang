import { Context, Effect } from "effect"
class Repo extends Context.Service<Repo,{value:number}>()("@coverage/keys/main#Repo") {}
class Nested extends Context.Service<Nested,{value:number}>()("@coverage/nested/users.test#Nested") {}
export const main = () => Effect.gen(function* () { return [Repo.key,Nested.key] })
