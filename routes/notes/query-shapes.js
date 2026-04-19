'use strict'

const NOTE_LIST_PROJECTION = Object.freeze({
  id: 1,
  title: 1,
  tags: 1,
  createdAt: 1,
  modifiedAt: 1,
})

const NOTE_EXPORT_PROJECTION = Object.freeze({
  title: 1,
  body: 1,
  tags: 1,
  createdAt: 1,
  modifiedAt: 1,
  id: 1,
})

module.exports = {
  NOTE_EXPORT_PROJECTION,
  NOTE_LIST_PROJECTION,
}