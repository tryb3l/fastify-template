'use strict'

const SLASH_CHAR_CODE = 47

function trimTrailingSlashes(value) {
  if (typeof value !== 'string' || value.length === 0) {
    return ''
  }

  let end = value.length
  while (end > 0 && value.charCodeAt(end - 1) === SLASH_CHAR_CODE) {
    end -= 1
  }

  return end === value.length ? value : value.slice(0, end)
}

function resolvePrimaryFrontendUrl(rawFrontendUrl) {
  if (typeof rawFrontendUrl !== 'string' || rawFrontendUrl.length === 0) {
    return ''
  }

  const commaIndex = rawFrontendUrl.indexOf(',')
  const firstEntry = commaIndex >= 0 ? rawFrontendUrl.slice(0, commaIndex) : rawFrontendUrl
  return trimTrailingSlashes(firstEntry.trim())
}

module.exports = {
  trimTrailingSlashes,
  resolvePrimaryFrontendUrl,
}
