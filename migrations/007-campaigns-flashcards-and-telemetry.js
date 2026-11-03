'use strict'

module.exports = {
  async up(db) {
    const notebooks = db.collection('notebooks')
    const notes = db.collection('notes')
    const flashcards = db.collection('flashcards')
    const dailyActivity = db.collection('dailyActivity')
    const users = db.collection('users')

    console.log('Creating campaigns, readiness, flashcards, and daily-activity indexes...')

    await notebooks.createIndex({ userId: 1, mode: 1, status: 1, modifiedAt: -1 })
    await notes.createIndex({ userId: 1, notebookId: 1, readiness: 1, noteType: 1 })
    await flashcards.createIndex({ id: 1 }, { unique: true })
    await flashcards.createIndex({ userId: 1, nextReviewAt: 1, box: 1 })
    await flashcards.createIndex({ userId: 1, noteId: 1 })
    await flashcards.createIndex({ userId: 1, modifiedAt: -1 })
    await dailyActivity.createIndex({ userId: 1, date: 1 }, { unique: true })
    await users.createIndex({ 'emailVerification.id': 1 }, { sparse: true })

    // Backfill notebooks with mode/status/targetDate
    await notebooks.updateMany(
      {
        $or: [
          { mode: { $exists: false } },
          { status: { $exists: false } },
          { targetDate: { $exists: false } },
        ],
      },
      [
        {
          $set: {
            mode: { $ifNull: ['$mode', 'notebook'] },
            status: { $ifNull: ['$status', 'active'] },
            targetDate: { $ifNull: ['$targetDate', null] },
          },
        },
      ],
    )

    // Backfill notes with readiness and noteType
    await notes.updateMany(
      {
        $or: [{ readiness: { $exists: false } }, { noteType: { $exists: false } }],
      },
      [
        {
          $set: {
            readiness: { $ifNull: ['$readiness', 'to_review'] },
            noteType: { $ifNull: ['$noteType', 'standard'] },
          },
        },
      ],
    )

    // Backfill users with emailVerified
    await users.updateMany({ emailVerified: { $exists: false } }, [
      {
        $set: {
          emailVerified: { $ifNull: ['$emailVerified', false] },
        },
      },
    ])
  },

  async down(db) {
    const notebooks = db.collection('notebooks')
    const notes = db.collection('notes')
    const flashcards = db.collection('flashcards')
    const dailyActivity = db.collection('dailyActivity')
    const users = db.collection('users')

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

    await safeDropIndex(notebooks, 'userId_1_mode_1_status_1_modifiedAt_-1')
    await safeDropIndex(notes, 'userId_1_notebookId_1_readiness_1_noteType_1')
    await safeDropIndex(flashcards, 'id_1')
    await safeDropIndex(flashcards, 'userId_1_nextReviewAt_1_box_1')
    await safeDropIndex(flashcards, 'userId_1_noteId_1')
    await safeDropIndex(flashcards, 'userId_1_modifiedAt_-1')
    await safeDropIndex(dailyActivity, 'userId_1_date_1')
    await safeDropIndex(users, 'emailVerification.id_1')
  },
}
