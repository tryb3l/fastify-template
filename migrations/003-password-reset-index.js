'use strict'

module.exports = {
  async up(db) {
    console.log('Creating sparse password reset index...')
    const users = db.collection('users')
    const backfillResult = await users.updateMany(
      { credentialsVersion: { $exists: false } },
      { $set: { credentialsVersion: 0 } }
    )
    console.log(`Backfilled credentialsVersion for ${backfillResult.modifiedCount} users`)
    await users.createIndex(
      { 'passwordReset.id': 1 }, 
      { sparse: true, unique: true }
    )
  },

  async down(db) {
    console.log('Dropping sparse password reset index...')
    const users = db.collection('users')

    const safeDropIndex = async (collection, indexName) => {
      try {
        await collection.dropIndex(indexName)
      } catch (err) {
        if (err.code !== 27) {
          throw err
        }
      }
    }

    await safeDropIndex(users, 'passwordReset.id_1')
  }
}
