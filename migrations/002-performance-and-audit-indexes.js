module.exports = {
    async up(db) {
        const notes = db.collection('notes')
        const users = db.collection('users')
        const auditLogs = db.collection('auditLogs')

        console.log('Creating performance and audit indexes...')

        await notes.createIndex({ userId: 1, modifiedAt: -1 })
        await notes.createIndex({ userId: 1, id: 1 }, { unique: true })

        await users.createIndex({ deleted: 1, role: 1 })

        await auditLogs.createIndex({ userId: 1, createdAt: -1 })
        await auditLogs.createIndex({ action: 1, createdAt: -1 })
        await auditLogs.createIndex({ resourceType: 1, resourceId: 1, createdAt: -1 })
    },

    async down(db) {
        const notes = db.collection('notes')
        const users = db.collection('users')
        const auditLogs = db.collection('auditLogs')

        console.log('Dropping performance and audit indexes...')

        const safeDropIndex = async (collection, indexName) => {
            try {
                await collection.dropIndex(indexName)
            } catch (err) {
                if (err && err.codeName === 'IndexNotFound') {
                    return
                }
                throw err
            }
        }

        await safeDropIndex(notes, 'userId_1_modifiedAt_-1')
        await safeDropIndex(notes, 'userId_1_id_1')

        await safeDropIndex(users, 'deleted_1_role_1')

        await safeDropIndex(auditLogs, 'userId_1_createdAt_-1')
        await safeDropIndex(auditLogs, 'action_1_createdAt_-1')
        await safeDropIndex(auditLogs, 'resourceType_1_resourceId_1_createdAt_-1')
    },
}
