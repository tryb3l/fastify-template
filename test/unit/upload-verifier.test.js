'use strict'

const test = require('node:test')
const assert = require('node:assert')
const path = require('node:path')
const vfs = require('node:vfs')
const { assertUploadedFileContent } = require('../../utils/upload-verifier')

const PNG_SAMPLE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aMcAAAAASUVORK5CYII=',
  'base64',
)

function createVirtualSampleFile(filename, content) {
  const memoryVfs = vfs.create({ emitExperimentalWarning: false })
  memoryVfs.writeFileSync(`/${filename}`, content)
  const mountPoint = memoryVfs.mount()

  return {
    filePath: path.join(mountPoint, filename),
    filename,
    [Symbol.dispose]() {
      memoryVfs.unmount()
    },
  }
}

test('assertUploadedFileContent accepts valid PNG content', async () => {
  using sample = createVirtualSampleFile('pixel.png', PNG_SAMPLE)

  await assert.doesNotReject(() =>
    assertUploadedFileContent({
      ...sample,
      mimeType: 'image/png',
    }),
  )
})

test('assertUploadedFileContent rejects random bytes masquerading as PNG', async () => {
  using sample = createVirtualSampleFile('fake.png', Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03]))

  await assert.rejects(
    () =>
      assertUploadedFileContent({
        ...sample,
        mimeType: 'image/png',
      }),
    (error) => error.statusCode === 415,
  )
})

test('assertUploadedFileContent accepts UTF-8 CSV content', async () => {
  using sample = createVirtualSampleFile('notes.csv', 'title,body\nSafe Title,Safe Body\n')

  await assert.doesNotReject(() =>
    assertUploadedFileContent({
      ...sample,
      mimeType: 'text/csv',
    }),
  )
})

test('assertUploadedFileContent rejects binary bytes declared as text/plain', async () => {
  using sample = createVirtualSampleFile('binary.txt', PNG_SAMPLE)

  await assert.rejects(
    () =>
      assertUploadedFileContent({
        ...sample,
        mimeType: 'text/plain',
      }),
    (error) => error.statusCode === 415,
  )
})

test('assertUploadedFileContent accepts valid WAV audio and MP4 video headers and rejects spoofed audio', async () => {
  // Minimal RIFF/WAVE header (44 bytes)
  const wavHeader = Buffer.alloc(44)
  wavHeader.write('RIFF', 0, 'ascii')
  wavHeader.writeUInt32LE(36, 4)
  wavHeader.write('WAVE', 8, 'ascii')
  wavHeader.write('fmt ', 12, 'ascii')
  wavHeader.writeUInt32LE(16, 16)
  wavHeader.writeUInt16LE(1, 20)
  wavHeader.writeUInt16LE(1, 22)
  wavHeader.writeUInt32LE(44100, 24)
  wavHeader.writeUInt32LE(88200, 28)
  wavHeader.writeUInt16LE(2, 32)
  wavHeader.writeUInt16LE(16, 34)
  wavHeader.write('data', 36, 'ascii')
  wavHeader.writeUInt32LE(0, 40)

  using wavSample = createVirtualSampleFile('voice.wav', wavHeader)
  await assert.doesNotReject(() =>
    assertUploadedFileContent({
      ...wavSample,
      mimeType: 'audio/wav',
    }),
  )

  // Minimal ISO BMFF / MP4 ftyp box
  const mp4Header = Buffer.from([
    0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32, 0x00, 0x00, 0x00, 0x00,
    0x6d, 0x70, 0x34, 0x32, 0x69, 0x73, 0x6f, 0x6d,
  ])
  using mp4Sample = createVirtualSampleFile('clip.mp4', mp4Header)
  await assert.doesNotReject(() =>
    assertUploadedFileContent({
      ...mp4Sample,
      mimeType: 'video/mp4',
    }),
  )

  using spoofedAudio = createVirtualSampleFile('spoof.mp3', Buffer.from('not an mp3 file'))
  await assert.rejects(
    () =>
      assertUploadedFileContent({
        ...spoofedAudio,
        mimeType: 'audio/mpeg',
      }),
    (error) => error.statusCode === 415,
  )
})
