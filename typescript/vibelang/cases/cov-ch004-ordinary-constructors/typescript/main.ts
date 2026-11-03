import { Effect } from "effect"
import * as Cli from "effect/cli/CliError"
class Plain{}
export function plain(s:unknown){return s instanceof Plain}
export function cli(s:unknown){return s instanceof Cli.UnrecognizedOption}
export function main():Effect.Effect<unknown>{return Effect.sync(()=>{const fake=Object.create(Plain.prototype);const changed=new Plain();Object.setPrototypeOf(changed,Object.prototype);const foreign=Object.create(Cli.UnrecognizedOption.prototype);return [[plain(fake),plain(changed)],[cli(foreign),cli({_tag:"UnrecognizedOption"})],Object.hasOwn(Cli,"CliError")]})}
