'use strict'

const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const { seedUser } = require('../utils/setup-user')

describe('Folders CRUD lifecycle', () => {
  test('creates folders inside a notebook, reads item and list, renames and reparents, deletes, and confirms 404', async (t) => {
    // Arrange
    const actor = await seedUser(t)
    const headers = { Authorization: `Bearer ${actor.accessToken}` }
    const notebook = await actor.app.notebooksDataSource.createNotebook(
      { name: 'Engineering KB' },
      actor.userId,
    )
    const parentFolder = await actor.app.notebooksDataSource.createFolder(
      { notebookId: notebook.id, name: 'Architecture' },
      actor.userId,
    )

    // Create (POST /notebooks/:id/folders)
    const createRes = await actor.app.inject({
      method: 'POST',
      url: `/notebooks/${notebook.id}/folders`,
      headers,
      payload: { name: 'Draft Subfolder' },
    })
    assert.equal(createRes.statusCode, 201)
    const created = createRes.json().data
    assert.equal(created.notebookId, notebook.id)
    assert.equal(created.parentId, null)

    // Read item & list (GET /notebooks/folders/:folderId & GET /notebooks/:id/folders)
    const getRes = await actor.app.inject({
      method: 'GET',
      url: `/notebooks/folders/${created.id}`,
      headers,
    })
    assert.equal(getRes.statusCode, 200)
    assert.equal(getRes.json().data.name, 'Draft Subfolder')

    const listRes = await actor.app.inject({
      method: 'GET',
      url: `/notebooks/${notebook.id}/folders`,
      headers,
    })
    assert.equal(listRes.statusCode, 200)
    assert.equal(listRes.json().data.length, 2)

    // Update (PUT /notebooks/folders/:folderId) and verify persisted rename + reparent
    const updateRes = await actor.app.inject({
      method: 'PUT',
      url: `/notebooks/folders/${created.id}`,
      headers,
      payload: {
        name: 'ADRs',
        parentId: parentFolder.id,
      },
    })
    assert.equal(updateRes.statusCode, 200)

    const getUpdatedRes = await actor.app.inject({
      method: 'GET',
      url: `/notebooks/folders/${created.id}`,
      headers,
    })
    assert.equal(getUpdatedRes.statusCode, 200)
    assert.equal(getUpdatedRes.json().data.name, 'ADRs')
    assert.equal(getUpdatedRes.json().data.parentId, parentFolder.id)

    // Delete (DELETE /notebooks/folders/:folderId) and confirm 404
    const deleteRes = await actor.app.inject({
      method: 'DELETE',
      url: `/notebooks/folders/${created.id}`,
      headers,
    })
    assert.equal(deleteRes.statusCode, 204)

    const getDeletedRes = await actor.app.inject({
      method: 'GET',
      url: `/notebooks/folders/${created.id}`,
      headers,
    })
    assert.equal(getDeletedRes.statusCode, 404)
  })
})
