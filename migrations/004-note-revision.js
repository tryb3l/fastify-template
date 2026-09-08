'use strict'

module.exports = {
  async up(db) {
    const notes = db.collection('notes')

    console.log('Backfilling note revision...')
    const backfillResult = await notes.updateMany(
      { revision: { $exists: false } },
      { $set: { revision: 1 } },
    )
    console.log(`Backfilled revision for ${backfillResult.modifiedCount} notes`)
  },

  async down(db) {
    const notes = db.collection('notes')

    console.log('Removing note revision field...')
    await notes.updateMany({}, { $unset: { revision: '' } })
  },
}
