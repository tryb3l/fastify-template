'use strict'

const crypto = require('node:crypto')
const { isUint32Array } = require('node:util/types')

const UINT32_MAX = 0xffffffff
const BUF_LEN = 1024
const BUF_SIZE = BUF_LEN * isUint32Array.BYTES_PER_ELEMENT

const randomPrefetcher = {
  buf: crypto.randomBytes(BUF_SIZE),
  pos: 0,
  next() {
    const { buf, pos } = this
    let start = pos
    if (start == buf.length) {
      start = 0
      crypto.randomFillSync(buf)
    }
    const end = start + Uint32Array.BYTES_PER_ELEMENT
    this.pos = end
    return buf.subarray(start, end)
  },
}

const cryptoRandom = () => {
  const buf = randomPrefetcher.next()
  return buf.readUInt32LE(0) / (UINT32_MAX + 1)
}

const generateUUID = () => {
  const h1 = randomPrefetcher.next().toString('hex')
  const h2 = randomPrefetcher.next().toString('hex')
  const buf = randomPrefetcher.next()
  buf[6] = (buf[6] & 0x0f) | 0x40
  buf[8] = (buf[8] & 0x3f) | 0x80
  const h3 = buf.toString('hex')
  const h4 = randomPrefetcher.next().toString('hex')
  const d2 = h2.substring(0, 4)
  const d3 = h3.substring(0, 4)
  const d4 = h3.substring(4, 8)
  const d5 = h2.substring(4, 8) + h4
  return [h1, d2, d3, d4, d5].join('-')
}

module.exports = {
  cryptoRandom,
  generateUUID,
}
