'use strict'

const { describe, test } = require('node:test')
const assert = require('node:assert/strict')

const {
  buildAttachmentEtag,
  buildContentDispositionHeader,
  doesIfNoneMatch,
  isNotModifiedSince,
  parseByteRangeHeader,
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

  test('buildContentDispositionHeader strips path traversal, replaces unsafe ASCII/non-ASCII with underscores, and includes RFC 5987', () => {
    // Arrange & Act & Assert
    assert.equal(
      buildContentDispositionHeader('report.pdf'),
      'attachment; filename="report.pdf"; filename*=UTF-8\'\'report.pdf',
    )
    assert.equal(
      buildContentDispositionHeader('../../etc/passwd'),
      'attachment; filename="passwd"; filename*=UTF-8\'\'passwd',
    )
    assert.equal(
      buildContentDispositionHeader('bad"file\r\nname\\x\0.txt'),
      'attachment; filename="bad_file__name_x_.txt"; filename*=UTF-8\'\'bad%22filename%5Cx.txt',
    )
    assert.equal(
      buildContentDispositionHeader('   '),
      'attachment; filename="attachment"; filename*=UTF-8\'\'%20%20%20',
    )
    assert.equal(
      buildContentDispositionHeader('"\r\n\0'),
      'attachment; filename="attachment"; filename*=UTF-8\'\'%22',
    )
    assert.equal(
      buildContentDispositionHeader(null),
      'attachment; filename="attachment"; filename*=UTF-8\'\'',
    )
    assert.equal(
      buildContentDispositionHeader('тест.txt'),
      'attachment; filename="____.txt"; filename*=UTF-8\'\'%D1%82%D0%B5%D1%81%D1%82.txt',
    )
    assert.equal(
      buildContentDispositionHeader('😀.txt'),
      'attachment; filename="_.txt"; filename*=UTF-8\'\'%F0%9F%98%80.txt',
    )
    assert.equal(
      buildContentDispositionHeader('hello(world)*.txt'),
      'attachment; filename="hello(world)*.txt"; filename*=UTF-8\'\'hello%28world%29%2A.txt',
    )
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
