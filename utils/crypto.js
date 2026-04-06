'use strict'

const crypto = require('node:crypto')
const fs = require('node:fs')

const UINT32_MAX = 0xffffffff
const BUF_LEN = 1024
const BUF_SIZE = BUF_LEN * Uint32Array.BYTES_PER_ELEMENT

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
  // Prevent out-of-bounds errors
  const b1 = randomPrefetcher.next()
  const b2 = randomPrefetcher.next()
  const b3 = randomPrefetcher.next()
  const b4 = randomPrefetcher.next()

  // Set version to 4 (in the 7th byte overall, which is index 2 of b2)
  b2[2] = (b2[2] & 0x0f) | 0x40
  // Set variant to 10xx (in the 9th byte overall, which is index 0 of b3)
  b3[0] = (b3[0] & 0x3f) | 0x80

  const h1 = b1.toString('hex')
  const h2 = b2.toString('hex')
  const h3 = b3.toString('hex')
  const h4 = b4.toString('hex')

  const d2 = h2.substring(0, 4)
  const d3 = h2.substring(4, 8)
  const d4 = h3.substring(0, 4)
  const d5 = h3.substring(4, 8) + h4

  return [h1, d2, d3, d4, d5].join('-')
}

const generateKey = (length, possible) => {
  const base = possible.length
  let key = ''
  for (let i = 0; i < length; i++) {
    const index = Math.floor(cryptoRandom() * base)
    key += possible[index]
  }
  return key
}

const CRC_LEN = 4

const crcToken = (secret, key) => {
  const md5 = crypto.createHash('md5').update(key).update(secret)
  return md5.digest('hex').substring(0, CRC_LEN)
}

const generateToken = (secret, characters, length) => {
  const key = generateKey(length - CRC_LEN, characters)
  return key + crcToken(secret, key)
}

const validateToken = (secret, token) => {
  if (!token || token.length < CRC_LEN) return false
  const length = token.length
  const crc = token.slice(length - CRC_LEN)
  const key = token.slice(0, -CRC_LEN)
  return crcToken(secret, key) === crc
}

const SALT_LEN = 32
const KEY_LEN = 32
const SCRYPT_PARAMS = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024, dkLen: 32 }
const SCRYPT_PREFIX = '$scrypt$N=32768,r=8,p=1,maxmem=67108864,dkLen=32$'

const serializeHash = (hash, salt) => {
  const saltString = salt.toString('base64').split('=')[0]
  const hashString = hash.toString('base64').split('=')[0]
  return `${SCRYPT_PREFIX}${saltString}$${hashString}`
}

const parseOptions = (options) => {
  const values = []
  const items = options.split(',')
  for (const item of items) {
    const [key, value] = item.split('=')
    values.push([key, Number(value)])
  }
  return Object.fromEntries(values)
}

const deserializeHash = (phcString) => {
  const [, name, options, salt64, hash64] = phcString.split('$')
  if (name !== 'scrypt') {
    throw new Error('Unsupported hash algorithm, Node.js crypto module only supports scrypt')
  }
  const params = parseOptions(options)
  const salt = Buffer.from(salt64, 'base64')
  const hash = Buffer.from(hash64, 'base64')
  return { params, salt, hash }
}

const randomBytesAsync = (size) => new Promise((resolve, reject) => {
  crypto.randomBytes(size, (err, buf) => {
    if (err) reject(err)
    else resolve(buf)
  })
})

const scryptAsync = (password, salt, keyLen, params) => new Promise((resolve, reject) => {
  crypto.scrypt(password, salt, keyLen, params, (err, derivedKey) => {
    if (err) reject(err)
    else resolve(derivedKey)
  })
})

const hashPassword = async (password) => {
  try {
    const salt = await randomBytesAsync(SALT_LEN)
    const hash = await scryptAsync(password, salt, KEY_LEN, SCRYPT_PARAMS)
    return serializeHash(hash, salt)
  } catch (err) {
    throw new Error('Error hashing the password: ' + err)
  }
}

const defaultSalt = crypto.randomBytes(SALT_LEN)
const defaultHashRaw = crypto.scryptSync('', defaultSalt, KEY_LEN, SCRYPT_PARAMS)
const defaultHash = serializeHash(defaultHashRaw, defaultSalt)

const validatePassword = (password, serHash = defaultHash) => {
  const { params, salt, hash } = deserializeHash(serHash)
  return new Promise((resolve, reject) => {
    const callback = (err, hashedPassword) => {
      if (err) {
        reject(err)
        return
      }
      resolve(crypto.timingSafeEqual(hashedPassword, hash))
    }
    crypto.scrypt(password, salt, hash.length, params, callback)
  })
}

const md5 = (filePath) => {
  const hash = crypto.createHash('md5')
  const file = fs.createReadStream(filePath)
  return new Promise((resolve, reject) => {
    file.on('error', reject)
    hash.once('readable', () => {
      resolve(hash.read().toString('hex'))
    })
    file.pipe(hash)
  })
}

module.exports = {
  cryptoRandom,
  generateUUID,
  generateKey,
  crcToken,
  generateToken,
  validateToken,
  serializeHash,
  deserializeHash,
  hashPassword,
  validatePassword,
  md5,
}