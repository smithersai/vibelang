// zipFixedTimes returns a copy of a zip archive whose every entry carries one
// fixed modification time, so archives built from the same files at different
// times are byte-identical. It rewrites the DOS time and date in each local and
// central header and the times in each extended-timestamp (0x5455) field, which
// vsce writes. Sizes, offsets, CRCs and compressed data stay unchanged.
//
// The fixed time is npm's tarball time, 1985-10-26 08:15:00 UTC.
export const fixedUnixTime = 499162500
const fixedDosTime = (8 << 11) | (15 << 5)
const fixedDosDate = ((1985 - 1980) << 9) | (10 << 5) | 26

export function zipFixedTimes(input) {
  const zip = Buffer.from(input)
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  if (eocd < 0 || eocd + 22 > zip.length) throw new Error("zipFixedTimes: no end of central directory record")
  const entries = zip.readUInt16LE(eocd + 10)
  let at = zip.readUInt32LE(eocd + 16)
  if (entries === 0xffff || at === 0xffffffff) throw new Error("zipFixedTimes: zip64 archives are not supported")
  for (let i = 0; i < entries; i++) {
    if (zip.readUInt32LE(at) !== 0x02014b50) throw new Error(`zipFixedTimes: central header ${i} is malformed`)
    zip.writeUInt16LE(fixedDosTime, at + 12)
    zip.writeUInt16LE(fixedDosDate, at + 14)
    const name = zip.readUInt16LE(at + 28), extra = zip.readUInt16LE(at + 30), comment = zip.readUInt16LE(at + 32)
    fixExtra(zip, at + 46 + name, extra)
    const local = zip.readUInt32LE(at + 42)
    if (zip.readUInt32LE(local) !== 0x04034b50) throw new Error(`zipFixedTimes: local header ${i} is malformed`)
    zip.writeUInt16LE(fixedDosTime, local + 10)
    zip.writeUInt16LE(fixedDosDate, local + 12)
    fixExtra(zip, local + 30 + zip.readUInt16LE(local + 26), zip.readUInt16LE(local + 28))
    at += 46 + name + extra + comment
  }
  return zip
}

function fixExtra(zip, start, length) {
  for (let at = start; at + 4 <= start + length;) {
    const id = zip.readUInt16LE(at), size = zip.readUInt16LE(at + 2)
    // Extended timestamp: a flags byte, then 4-byte Unix times.
    if (id === 0x5455) for (let t = at + 5; t + 4 <= at + 4 + size; t += 4) zip.writeUInt32LE(fixedUnixTime, t)
    else if (id === 0x000a) throw new Error("zipFixedTimes: NTFS timestamp fields are not supported")
    at += 4 + size
  }
}
