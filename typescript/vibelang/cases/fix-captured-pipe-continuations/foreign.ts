const events: string[] = []
/** @throws {never} */
export function record(name: string): number { events.push("program " + name); return 1 }
/** @throws {never} */
export function build(name: string) {
  events.push("build " + name)
  return /** @throws {never} */ function (value: number): number { events.push("apply " + name); return value + 1 }
}
/** @throws {never} */
export function finish(): void { console.log(JSON.stringify(events)) }
