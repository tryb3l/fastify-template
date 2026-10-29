'use strict'

module.exports = {
  async up(db) {
    const notebooks = db.collection('notebooks')
    const folders = db.collection('folders')
    const notes = db.collection('notes')

    console.log('Creating notebooks, folders, and note-link indexes...')

    await notebooks.createIndex({ userId: 1, id: 1 }, { unique: true })
    await notebooks.createIndex({ userId: 1, modifiedAt: -1 })

    await folders.createIndex({ userId: 1, id: 1 }, { unique: true })
    await folders.createIndex({ userId: 1, notebookId: 1, parentId: 1 })

    await notes.createIndex({ userId: 1, notebookId: 1, folderId: 1, modifiedAt: -1 })
    await notes.createIndex({ userId: 1, 'links.targetId': 1 })

    await notes.updateMany(
      {
        $or: [
          { notebookId: { $exists: false } },
          { folderId: { $exists: false } },
          { links: { $exists: false } },
        ],
      },
      [
        {
          $set: {
            notebookId: { $ifNull: ['$notebookId', null] },
            folderId: {
              $cond: [
                { $eq: [{ $ifNull: ['$notebookId', null] }, null] },
                null,
                { $ifNull: ['$folderId', null] },
              ],
            },
            links: { $ifNull: ['$links', []] },
          },
        },
      ],
    )
  },

  async down(db) {
    const notebooks = db.collection('notebooks')
    const folders = db.collection('folders')
    const notes = db.collection('notes')

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

    await safeDropIndex(notebooks, 'userId_1_id_1')
    await safeDropIndex(notebooks, 'userId_1_modifiedAt_-1')

    await safeDropIndex(folders, 'userId_1_id_1')
    await safeDropIndex(folders, 'userId_1_notebookId_1_parentId_1')

    await safeDropIndex(notes, 'userId_1_notebookId_1_folderId_1_modifiedAt_-1')
    await safeDropIndex(notes, 'userId_1_links.targetId_1')

    await notes.updateMany({}, { $unset: { notebookId: '', folderId: '', links: '' } })
  },
}
