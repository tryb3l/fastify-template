'use strict'

const crypto = require('node:crypto')
const util = require('node:util')

const pbkdf2 = util.promisify(crypto.pbkdf2)

async function generateHash(password, salt) {
  if (!salt) {
    salt = crypto.randomBytes(16).toString('hex')
  }
  const hash = (await pbkdf2(password, salt, 1000, 64, 'sha256')).toString('hex')
  return { salt, hash }
}

async function verifyPassword(submittedPassword, storedSalt, storedHash) {
  const { hash: computedHash } = await generateHash(submittedPassword, storedSalt)

  const computedBuffer = Buffer.from(computedHash, 'hex')
  const storedBuffer = Buffer.from(storedHash, 'hex')

  if (computedBuffer.length !== storedBuffer.length) return false

  return crypto.timingSafeEqual(computedBuffer, storedBuffer)
}

module.exports = {
  generateHash,
  verifyPassword
}