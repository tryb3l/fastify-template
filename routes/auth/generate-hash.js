'use strict'

const argon2 = require('argon2')

const hashPassword = async (password) => {
  try {
    return await argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 4,
    })
  } catch (err) {
    throw new Error('Error hashing password: ' + err.message, { cause: err })
  }
}

const validatePassword = async (password, hash) => {
  return argon2.verify(hash, password)
}

module.exports = {
  hashPassword,
  validatePassword,
}
