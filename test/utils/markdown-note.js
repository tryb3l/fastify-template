'use strict'

function buildSection(sectionNumber) {
  return [
    `## Section ${sectionNumber}`,
    '',
    `Paragraph ${sectionNumber} keeps Markdown-first storage intact with [links](https://example.com/sections/${sectionNumber}) and \`inline-${sectionNumber}\` tokens.`,
    '',
    '- checklist item',
    `  - nested detail ${sectionNumber}.1`,
    `  - nested detail ${sectionNumber}.2`,
    '',
    '```js',
    `export function section${sectionNumber}(input) {`,
    `  return \`section-${sectionNumber}:\${input}\``,
    '}',
    '```',
    '',
    `1. Ordered point ${sectionNumber}`,
    `2. Follow-up point ${sectionNumber}`,
    '',
    `> Blockquote ${sectionNumber}: preserve Markdown content exactly across storage, reads, CSV, and websocket broadcasts.`,
    '',
    '| Column | Value |',
    '| --- | --- |',
    `| heading | section-${sectionNumber} |`,
    `| status | ready-${sectionNumber} |`,
    '',
  ].join('\n')
}

function buildMarkdownNote({ minLength = 32000 } = {}) {
  let body = [
    '# Milkdown Fixture',
    '',
    'A realistic Markdown note with headings, fenced code, links, nested lists, ordered lists, tables, and blockquotes.',
    '',
  ].join('\n')

  let sectionNumber = 1
  while (body.length < minLength) {
    body += buildSection(sectionNumber)
    sectionNumber += 1
  }

  return body
}

module.exports = {
  buildMarkdownNote,
}