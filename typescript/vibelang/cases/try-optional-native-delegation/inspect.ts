/** @throws {never} */
export function inspect(exit: any) {
 return exit._tag === "Success" ? ["Success", exit.value]
  : ["Failure", exit.cause.reasons[0].defect.constructor.name]
}
