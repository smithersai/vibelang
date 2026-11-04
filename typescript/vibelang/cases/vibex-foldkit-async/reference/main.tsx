import { Effect } from "effect"
import { runtime, Api, useAtomValue, AsyncResult, Spinner, ErrorBanner, Profile } from "./ui.js"
const userAtom = runtime.atom(Effect.gen(function* () {
  const api = yield* Api
  return yield* api.getUser()
}))
export const UserCard = () => {
  const user = useAtomValue(userAtom)
  return AsyncResult.builder(user)
    .onInitial(() => <Spinner />)
    .onFailure(cause => <ErrorBanner message={cause} />)
    .onSuccess(user => <Profile user={user} />)
    .render()
}
