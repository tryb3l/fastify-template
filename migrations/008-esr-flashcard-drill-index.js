'use strict'

const ESR_DRILL_INDEX_NAME = 'userId_1_noteId_1_box_1_nextReviewAt_1'

module.exports = {
  async up(db) {
    const flashcards = db.collection('flashcards')
    console.log('Creating ESR compound index for flashcard drill queries...')
    await flashcards.createIndex({ userId: 1, noteId: 1, box: 1, nextReviewAt: 1 })
  },

  async down(db) {
    const flashcards = db.collection('flashcards')
    try {
      await flashcards.dropIndex(ESR_DRILL_INDEX_NAME)
    } catch (err) {
      if (err && (err.codeName === 'IndexNotFound' || err.codeName === 'NamespaceNotFound')) {
        return
      }
      throw err
    }
  },
}
