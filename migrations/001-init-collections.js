const { randomUUIDv7 } = require('node:crypto')
const { hashPassword } = require('../routes/auth/generate-hash')

module.exports = {
  async up(db) {
    const users = db.collection('users')
    const revokedTokens = db.collection('revokedTokens')

    console.log('Creating strict security indexes natively outside Fastify boot pipeline...')
    await revokedTokens.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })

    await users.createIndex({ username: 1 }, { unique: true })
    await users.createIndex({ email: 1 }, { unique: true })

    console.log('Checking database for initial seed data natively...')

    if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD) {
      console.warn(
        'Skipping default admin seeding: ADMIN_EMAIL or ADMIN_PASSWORD environments are undefined.',
      )
      return
    }

    const normalizedAdminEmail = String(process.env.ADMIN_EMAIL).trim().toLowerCase()
    const adminExists = await users.findOne({ email: normalizedAdminEmail })

    if (!adminExists) {
      console.log('No admin user found. Seeding default admin account...')
      const hash = await hashPassword(process.env.ADMIN_PASSWORD || 'ChangeThisNow!2026')
      const _id = randomUUIDv7()
      const now = new Date()

      try {
        await users.insertOne({
          _id,
          id: _id,
          username: 'admin',
          email: normalizedAdminEmail,
          hash: hash,
          role: 'admin',
          credentialsVersion: 0,
          createdAt: now,
          modifiedAt: now,
        })
        console.log('Default admin account seeded successfully!')
      } catch (err) {
        if (err.code === 11000) {
          console.log('Admin account seeded concurrently by another process. Skipping.')
        } else {
          throw err
        }
      }
    } else {
      console.log('Admin account already exists. Skipping seed.')
    }
  },

  async down(db) {
    console.log('Reverting indexes natively...')
    await db.collection('users').dropIndex('username_1')
    await db.collection('users').dropIndex('email_1')
    await db.collection('revokedTokens').dropIndex('expiresAt_1')
  },
}
