'use strict'

const argon2 = require('argon2')

const hashPassword = async (password) => {
  try {
    return await argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 4
    });
  } catch (err) {
    throw new Error('Error hashing password: ' + err.message);
  }
};

const validatePassword = async (password, hash) => {
  try {
    return await argon2.verify(hash, password);
  } catch (err) {
    return false;
  }
};

module.exports = {
  hashPassword,
  validatePassword
}