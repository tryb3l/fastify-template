'use strict'

const t = require('tap')
const { setup } = require('../../../../utils/setup-user')
const { randomString } = require('../../../../utils/data-creator')
const { randomUUID } = require('node:crypto')

t.beforeEach(async (t) => {
  const { app, accessToken, refreshToken } = await setup(t)
  t.context.app = app
  t.context.accessToken = accessToken
  t.context.refreshToken = refreshToken

  // Create a note before each test
  const noteTitle = randomString(10)
  const noteBody = randomString(20)
  const noteTags = [randomString(5)]

  const response = await app.inject({
    method: 'POST',
    url: '/notes/',
    headers: {
      contentType: 'application/json',
    },
    cookies: {
      accessToken: accessToken,
      refreshToken: refreshToken,
    },
    payload: {
      title: noteTitle,
      body: noteBody,
      tags: noteTags,
    },
  })

  t.equal(response.statusCode, 201)
  t.type(response.json(), 'object')
  t.ok(response.json().id)
  t.equal(typeof response.json().id, 'string')

  t.context.noteId = response.json().id
})

t.skip('PUT /notes/:id 200 - Update a note', async (t) => {
  // Arrange
  const { app, accessToken, refreshToken, noteId } = t.context
  const updatedNote = {
    title: 'Updated Title',
    body: 'Updated Body',
    tags: ['updatedTag'],
  }

  // Act
  const response = await app.inject({
    method: 'PUT',
    url: `/notes/${noteId}`,
    headers: {
      contentType: 'application/json',
    },
    cookies: {
      accessToken: accessToken,
      refreshToken: refreshToken,
    },
    payload: updatedNote,
  })

  // Assert
  t.equal(response.statusCode, 200)
  t.type(response.json(), 'object')
  t.equal(response.json().data.id, noteId)
  t.equal(response.json().data.title, updatedNote.title)
  t.equal(response.json().data.body, updatedNote.body)
  t.same(response.json().data.tags, updatedNote.tags)
})

t.skip('PUT /notes/:id 404 - Note not found', async (t) => {
  // Arrange
  const { app, accessToken, refreshToken } = t.context
  const nonExistentNoteId = randomUUID()
  const updatedNote = {
    title: 'Updated Title',
    body: 'Updated Body',
    tags: ['updatedTag'],
  }

  // Act
  const response = await app.inject({
    method: 'PUT',
    url: `/notes/${nonExistentNoteId}`,
    headers: {
      contentType: 'application/json',
    },
    cookies: {
      accessToken: accessToken,
      refreshToken: refreshToken,
    },
    payload: updatedNote,
  })

  // Assert
  t.equal(response.statusCode, 404)
  t.type(response.json(), 'object')
})

t.skip('PUT /notes/:id 400 - Invalid id format', async (t) => {
  // Arrange
  const { app, accessToken, refreshToken } = t.context
  const invalidNoteId = 'invalid-id'
  const updatedNote = {
    title: 'Updated Title',
    body: 'Updated Body',
    tags: ['updatedTag'],
  }

  // Act
  const response = await app.inject({
    method: 'PUT',
    url: `/notes/${invalidNoteId}`,
    headers: {
      contentType: 'application/json',
    },
    cookies: {
      accessToken: accessToken,
      refreshToken: refreshToken,
    },
    payload: updatedNote,
  })

  // Assert
  t.equal(response.statusCode, 400)
  t.type(response.json(), 'object')
})

t.skip('PUT /notes/:id 400 - Missing title', async (t) => {
  // Arrange
  const { app, accessToken, refreshToken, noteId } = t.context
  const updatedNote = {
    body: 'Updated Body',
    tags: ['updatedTag'],
  }

  // Act
  const response = await app.inject({
    method: 'PUT',
    url: `/notes/${noteId}`,
    headers: {
      contentType: 'application/json',
    },
    cookies: {
      accessToken: accessToken,
      refreshToken: refreshToken,
    },
    payload: updatedNote,
  })

  // Assert
  t.equal(response.statusCode, 400)
  t.type(response.json(), 'object')
})

t.skip('PUT /notes/:id 400 - Missing body', async (t) => {
  // Arrange
  const { app, accessToken, refreshToken, noteId } = t.context
  const updatedNote = {
    title: 'Updated Title',
    tags: ['updatedTag'],
  }

  // Act
  const response = await app.inject({
    method: 'PUT',
    url: `/notes/${noteId}`,
    headers: {
      contentType: 'application/json',
    },
    cookies: {
      accessToken: accessToken,
      refreshToken: refreshToken,
    },
    payload: updatedNote,
  })

  // Assert
  t.equal(response.statusCode, 400)
  t.type(response.json(), 'object')
})

t.skip('PUT /notes/:id 400 - Title too short', async (t) => {
  // Arrange
  const { app, accessToken, refreshToken, noteId } = t.context
  const updatedNote = {
    title: '',
    body: 'Updated Body',
    tags: ['updatedTag'],
  }

  // Act
  const response = await app.inject({
    method: 'PUT',
    url: `/notes/${noteId}`,
    headers: {
      contentType: 'application/json',
    },
    cookies: {
      accessToken: accessToken,
      refreshToken: refreshToken,
    },
    payload: updatedNote,
  })

  // Assert
  t.equal(response.statusCode, 400)
  t.type(response.json(), 'object')
})

t.skip('PUT /notes/:id 400 - Title too long', async (t) => {
  // Arrange
  const { app, accessToken, refreshToken, noteId } = t.context
  const longTitle = randomString(101)
  const updatedNote = {
    title: longTitle,
    body: 'Updated Body',
    tags: ['updatedTag'],
  }

  // Act
  const response = await app.inject({
    method: 'PUT',
    url: `/notes/${noteId}`,
    headers: {
      contentType: 'application/json',
    },
    cookies: {
      accessToken: accessToken,
      refreshToken: refreshToken,
    },
    payload: updatedNote,
  })

  // Assert
  t.equal(response.statusCode, 400)
  t.type(response.json(), 'object')
})

t.skip('PUT /notes/:id 400 - Body too short', async (t) => {
  // Arrange
  const { app, accessToken, refreshToken, noteId } = t.context
  const updatedNote = {
    title: 'Updated Title',
    body: '',
    tags: ['updatedTag'],
  }

  // Act
  const response = await app.inject({
    method: 'PUT',
    url: `/notes/${noteId}`,
    headers: {
      contentType: 'application/json',
    },
    cookies: {
      accessToken: accessToken,
      refreshToken: refreshToken,
    },
    payload: updatedNote,
  })

  // Assert
  t.equal(response.statusCode, 400)
  t.type(response.json(), 'object')
})

t.skip('PUT /notes/:id 400 - Body too long', async (t) => {
  // Arrange
  const { app, accessToken, refreshToken, noteId } = t.context
  const longBody = randomString(10001)
  const updatedNote = {
    title: 'Updated Title',
    body: longBody,
    tags: ['updatedTag'],
  }

  // Act
  const response = await app.inject({
    method: 'PUT',
    url: `/notes/${noteId}`,
    headers: {
      contentType: 'application/json',
    },
    cookies: {
      accessToken: accessToken,
      refreshToken: refreshToken,
    },
    payload: updatedNote,
  })

  // Assert
  t.equal(response.statusCode, 400)
  t.type(response.json(), 'object')
})

t.skip('PUT /notes/:id 400 - Invalid tags', async (t) => {
  // Arrange
  const { app, accessToken, refreshToken, noteId } = t.context
  const invalidTags = [randomString(11)]
  const updatedNote = {
    title: 'Updated Title',
    body: 'Updated Body',
    tags: invalidTags,
  }

  // Act
  const response = await app.inject({
    method: 'PUT',
    url: `/notes/${noteId}`,
    headers: {
      contentType: 'application/json',
    },
    cookies: {
      accessToken: accessToken,
      refreshToken: refreshToken,
    },
    payload: updatedNote,
  })

  // Assert
  t.equal(response.statusCode, 400)
  t.type(response.json(), 'object')
})
