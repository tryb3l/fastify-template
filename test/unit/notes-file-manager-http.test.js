'use strict'

const { describe, test } = require('node:test')
const assert = require('node:assert/strict')

const {
  buildAttachmentEtag,
  doesIfNoneMatch,
  isNotModifiedSince,
  parseByteRangeHeader,
  sanitizeContentDispositionFilename,
} = require('../../plugins/notes-file-manager')

describe('notes-file-manager pure HTTP utilities', () => {
  test('buildAttachmentEtag formats weak ETag from size and mtimeInstant or mtimeMs', () => {
    // Arrange & Act & Assert
    assert.equal(
      buildAttachmentEtag({ size: 2048, mtimeInstant: { epochNanoseconds: 123456789n } }),
      'W/"2048-123456789"',
    )
    assert.equal(buildAttachmentEtag({ size: 512, mtimeMs: 987654 }), 'W/"512-987654"')
  })

  test('doesIfNoneMatch handles wildcard, weak/strong ETags, and comma-separated lists', () => {
    // Arrange
    const etag = 'W/"2048-123456"'

    // Act & Assert
    assert.equal(doesIfNoneMatch(undefined, etag), false)
    assert.equal(doesIfNoneMatch('*', etag), true)
    assert.equal(doesIfNoneMatch('W/"2048-123456"', etag), true)
    assert.equal(doesIfNoneMatch('"2048-123456"', etag), true)
    assert.equal(doesIfNoneMatch('"other", W/"2048-123456"', etag), true)
    assert.equal(doesIfNoneMatch('"other-1", "other-2"', etag), false)
  })

  test('isNotModifiedSince compares whole seconds and ignores invalid headers', () => {
    // Arrange
    const fileStats = {
      mtimeInstant: { epochMilliseconds: Date.parse('2026-05-01T12:00:10.900Z') },
    }

    // Act & Assert
    assert.equal(isNotModifiedSince(undefined, fileStats), false)
    assert.equal(isNotModifiedSince('not-a-date', fileStats), false)
    assert.equal(isNotModifiedSince('Fri, 01 May 2026 12:00:10 GMT', fileStats), true)
    assert.equal(isNotModifiedSince('Fri, 01 May 2026 12:00:09 GMT', fileStats), false)

    const legacyStats = { mtime: new Date('2026-05-01T12:00:10.000Z') }
    assert.equal(isNotModifiedSince('Fri, 01 May 2026 12:00:10 GMT', legacyStats), true)
  })

  test('sanitizeContentDispositionFilename strips path traversal and unsafe characters', () => {
    // Arrange & Act & Assert
    assert.equal(sanitizeContentDispositionFilename('report.pdf'), 'report.pdf')
    assert.equal(sanitizeContentDispositionFilename('../../etc/passwd'), 'passwd')
    assert.equal(
      sanitizeContentDispositionFilename('bad"file\r\nname\\x\0.txt'),
      'bad_file__name_x_.txt',
    )
    assert.equal(sanitizeContentDispositionFilename('   '), 'attachment')
    assert.equal(sanitizeContentDispositionFilename('"\r\n\0'), 'attachment')
    assert.equal(sanitizeContentDispositionFilename(null), 'attachment')
  })

  test('parseByteRangeHeader parses valid ranges and flags unsatisfiable ranges', () => {
    // Arrange & Act & Assert
    assert.equal(parseByteRangeHeader(undefined, 100), null)
    assert.deepEqual(parseByteRangeHeader('items=0-10', 100), { satisfiable: false })
    assert.deepEqual(parseByteRangeHeader('bytes=0-1, 2-3', 100), { satisfiable: false })
    assert.deepEqual(parseByteRangeHeader('bytes=-', 100), { satisfiable: false })
    assert.deepEqual(parseByteRangeHeader('bytes=0-0', 0), { satisfiable: false })
    assert.deepEqual(parseByteRangeHeader('bytes=100-110', 100), { satisfiable: false })
    assert.deepEqual(parseByteRangeHeader('bytes=20-10', 100), { satisfiable: false })
    assert.deepEqual(parseByteRangeHeader('bytes=-0', 100), { satisfiable: false })

    assert.deepEqual(parseByteRangeHeader('bytes=0-9', 100), {
      satisfiable: true,
      start: 0,
      end: 9,
      contentLength: 10,
      contentRange: 'bytes 0-9/100',
    })
    assert.deepEqual(parseByteRangeHeader('bytes=90-500', 100), {
      satisfiable: true,
      start: 90,
      end: 99,
      contentLength: 10,
      contentRange: 'bytes 90-99/100',
    })
    assert.deepEqual(parseByteRangeHeader('bytes=75-', 100), {
      satisfiable: true,
      start: 75,
      end: 99,
      contentLength: 25,
      contentRange: 'bytes 75-99/100',
    })
    assert.deepEqual(parseByteRangeHeader('bytes=-15', 100), {
      satisfiable: true,
      start: 85,
      end: 99,
      contentLength: 15,
      contentRange: 'bytes 85-99/100',
    })
    assert.deepEqual(parseByteRangeHeader('bytes=-500', 100), {
      satisfiable: true,
      start: 0,
      end: 99,
      contentLength: 100,
      contentRange: 'bytes 0-99/100',
    })
  })
})
