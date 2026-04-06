'use strict'

const fp = require('fastify-plugin')
const crypto = require('node:crypto')
const { hashPassword } = require('../routes/auth/generate-hash')

async function passwordResetPlugin(fastify, options) {
  fastify.log.info('Starting registration of password-reset service plugin')

  const frontendBaseUrl = String(fastify.config.FRONTEND_URL || '')
    .split(',')[0]
    .trim()
    .replace(/\/+$/, '')

  const generateOpaqueToken = () => {
    const id = crypto.randomUUID()
    const secret = crypto.randomBytes(32).toString('hex')
    return { id, secret }
  }

  const hashSecret = (secret) => {
    return crypto.createHash('sha256').update(secret).digest('hex')
  }

  const passwordResetServiceApi = {
    async requestReset(email) {
      // Validate user existence passively no leak via UI
      const user = await fastify.usersDataSource.readUser(email)
      if (!user) return // Silently prt. we accepted it

      // Generate secure atomic token (1 hour exp)
      const { id, secret } = generateOpaqueToken()
      const secretHash = hashSecret(secret)
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000)

      // Atomically embed to User document
      const initiated = await fastify.usersDataSource.initiatePasswordReset(email, id, secretHash, expiresAt)
      if (!initiated) return // User got deleted midflight or smth

      // Construct URL and send email
      const resetToken = `${id}.${secret}`
      const resetUrl = `${frontendBaseUrl}/reset-password/confirm#token=${encodeURIComponent(resetToken)}`

      try {
        await fastify.mailer.sendPasswordResetMail({ to: user.email, rawResetUrl: resetUrl })
      } catch (err) {
        // Rollback atomic DB state so usrs aren't locked out of trying again
        fastify.log.error({ err, email }, 'Could not dispatch reset email, rolling back atomic session.')
        await fastify.usersDataSource.rescindPasswordReset(id)
      }
    },

    async validateToken(resetId, rawSecret) {
      const resetData = await fastify.usersDataSource.checkPasswordResetExists(resetId)
      if (!resetData || !resetData.passwordReset || !resetData.passwordReset.secretHash) {
        return false
      }

      const incomingHash = hashSecret(rawSecret)
      return crypto.timingSafeEqual(
        Buffer.from(incomingHash, 'hex'),
        Buffer.from(resetData.passwordReset.secretHash, 'hex')
      )
    },

    async executeReset(resetId, rawSecret, newPassword) {
      const secretHash = hashSecret(rawSecret)
      const newPasswordHash = await hashPassword(newPassword)

      try {
        const user = await fastify.usersDataSource.verifyAndExecutePasswordReset(resetId, secretHash, newPasswordHash)
        if (!user) {
          return false
        }

        // Fire async confirmation email
        setImmediate(() => {
          fastify.mailer.sendPasswordResetSuccessMail({ to: user.email }).catch(err => {
            fastify.log.warn({ err }, 'Could not send reset confirmation email, but password was reset.')
          })
        })

        return true
      } catch (error) {
        // Handle race conditions or edge cases gracefully
        fastify.log.warn({ error }, 'Atomic reset failed during execution phase')
        return false
      }
    }
  }

  fastify.decorate('passwordResetService', passwordResetServiceApi)
}

module.exports = fp(passwordResetPlugin, {
  name: 'password-reset-plugin',
  dependencies: ['application-config', 'users-store', 'mailer-plugin'],
  decorators: {
    fastify: ['config', 'usersDataSource', 'mailer']
  }
})
