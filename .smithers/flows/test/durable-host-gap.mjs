// The smthrs native helper is a dynamically linked binary. On a host whose C
// library is older than the one it was linked against, the loader refuses it
// and smthrs cannot start a run. `hostGap` recognizes exactly that refusal in
// smthrs output and returns the reason; any other output gives undefined.
const refusal = /AtomicHelperFault: atomic helper exited \d+: \S+: \S+: version `(GLIBC_[0-9.]+)\\?' not found/

export function hostGap(output) {
  const found = refusal.exec(output)
  return found === null ? undefined : `this host's C library lacks ${found[1]}, which the smthrs native helper needs`
}
