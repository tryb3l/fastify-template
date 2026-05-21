'use strict'

const assert = require('node:assert')

const CSRF_COOKIE_NAME = '_csrf'

function getSetCookieValues(setCookieHeader) {
  if (!setCookieHeader) {
    return []
  }

  return Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader]
}

function getCookiePair(setCookieHeader, cookieName = CSRF_COOKIE_NAME) {
  const cookie = getSetCookieValues(setCookieHeader).find((value) =>
    value.startsWith(`${cookieName}=`),
  )

  assert.ok(cookie, `${cookieName} cookie should be present`)

  return cookie.split(';')[0]
}

async function issueCsrfContext(app) {
  const csrfResponse = await app.inject({
    method: 'GET',
    url: '/auth/csrf',
  })

  assert.strictEqual(csrfResponse.statusCode, 200)

  const csrfToken = csrfResponse.json().csrfToken
  assert.ok(csrfToken, 'CSRF token should be present')

  return {
    csrfToken,
    csrfCookieHeader: getCookiePair(csrfResponse.headers['set-cookie']),
  }
}

function buildRefreshTokenCookieHeader(refreshToken, csrfCookieHeader) {
  assert.ok(refreshToken, 'Refresh token should be present')
  assert.ok(csrfCookieHeader, 'CSRF cookie should be present')

  return `refreshToken=${refreshToken}; ${csrfCookieHeader}`
}

module.exports = {
  buildRefreshTokenCookieHeader,
  getCookiePair,
  issueCsrfContext,
}
