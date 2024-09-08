const split = require('split2')
const t = require('tap')
const { setup } = require('./utils/setup-user')

t.skip('logger must redact sensitive data', async (t) => {
  t.plan(7)

  // Setup user and get app instance
  const { app, accessToken, refreshToken, username, password } = await setup(t)

  const stream = split(JSON.parse)
  app.log.stream = stream

  const loginResponse = await app.inject({
    method: 'POST',
    url: '/auth/authenticate',
    payload: { username: username, password: password },
    cookies: {
      accessToken: accessToken,
      refreshToken: refreshToken,
    },
  })

  // Log the login response for debugging
  console.log('Login Response:', loginResponse.statusCode, loginResponse.json())

  // Assert login response
  t.equal(loginResponse.statusCode, 200)
  const cookies = loginResponse.cookies
  const accessTokenCookie = cookies.find((cookie) => cookie.name === 'accessToken')
  const refreshTokenCookie = cookies.find((cookie) => cookie.name === 'refreshToken')

  t.ok(accessTokenCookie, 'accessToken cookie should be set')
  t.ok(refreshTokenCookie, 'refreshToken cookie should be set')
  t.match(accessTokenCookie.value, /.+/, 'accessToken should have a value')
  t.match(refreshTokenCookie.value, /.+/, 'refreshToken should have a value')

  for await (const line of stream) {
    if (line.msg === 'request completed') {
      t.ok(line.req.body, 'the request does log the body')
      t.equal(line.req.body.password, '*****', 'the password is redacted')
      break
    }
  }
})
