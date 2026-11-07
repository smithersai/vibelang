const events: string[] = []
/** @throws {never} */
export function record(name: string): void { events.push("program " + name) }
/** @throws {never} */
export function build(name: string) {
  events.push("build " + name)
  return /** @throws {never} */ function (_value: void): void { events.push("apply " + name) }
}
/** @throws {never} */
export function finish(): void { console.log(JSON.stringify(events)) }
