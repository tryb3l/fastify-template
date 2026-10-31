'use strict'

const SYNC_TOMBSTONE_TTL_SECONDS = 30 * 24 * 60 * 60

module.exports = {
  async up(db) {
    const revokedTokens = db.collection('revokedTokens')
    const userInvites = db.collection('userInvites')
    const syncTombstones = db.collection('syncTombstones')
    const folders = db.collection('folders')
    const users = db.collection('users')

    console.log('Creating users, invites, delta-sync, and revoked-tokens indexes...')

    await revokedTokens.createIndex({ userId: 1 })

    await userInvites.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
    await userInvites.createIndex({ email: 1, consumedAt: 1 })

    await syncTombstones.createIndex(
      { deletedAt: 1 },
      { expireAfterSeconds: SYNC_TOMBSTONE_TTL_SECONDS },
    )
    await syncTombstones.createIndex({ userId: 1, deletedAt: 1 })

    await folders.createIndex({ userId: 1, modifiedAt: -1 })

    // Backfill normalized id and modifiedAt on any existing user documents
    await users.updateMany(
      {
        $or: [{ id: { $exists: false } }, { modifiedAt: { $exists: false } }],
      },
      [
        {
          $set: {
            id: { $toString: '$_id' },
            modifiedAt: { $ifNull: ['$modifiedAt', { $ifNull: ['$updatedAt', '$createdAt'] }] },
          },
        },
      ],
    )
  },

  async down(db) {
    const revokedTokens = db.collection('revokedTokens')
    const userInvites = db.collection('userInvites')
    const syncTombstones = db.collection('syncTombstones')
    const folders = db.collection('folders')

    const safeDropIndex = async (collection, indexName) => {
      try {
        await collection.dropIndex(indexName)
      } catch (err) {
        if (err && (err.codeName === 'IndexNotFound' || err.codeName === 'NamespaceNotFound')) {
          return
        }
        throw err
      }
    }

    await safeDropIndex(revokedTokens, 'userId_1')
    await safeDropIndex(userInvites, 'expiresAt_1')
    await safeDropIndex(userInvites, 'email_1_consumedAt_1')
    await safeDropIndex(syncTombstones, 'deletedAt_1')
    await safeDropIndex(syncTombstones, 'userId_1_deletedAt_1')
    await safeDropIndex(folders, 'userId_1_modifiedAt_-1')
  },
}
