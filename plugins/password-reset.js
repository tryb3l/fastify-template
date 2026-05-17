'use strict'

const fp = require('fastify-plugin')
const crypto = require('node:crypto')
const { hashPassword } = require('../routes/auth/generate-hash')
const {
  addInstantDuration,
  compareInstants,
  instantFromDate,
  instantToDate,
  nowInstant,
} = require('../utils/time')

async function passwordResetPlugin(fastify) {
  fastify.log.info('Starting registration of password-reset service plugin')

  const frontendBaseUrl = String(fastify.config.FRONTEND_URL || '')
    .split(',')[0]
    .trim()
    .replace(/\/+$/, '')
  const ttlMinutes = Math.max(1, Number(fastify.config.passwordReset?.ttlMinutes || 60))
  const requestCooldownMs =
    Math.max(0, Number(fastify.config.passwordReset?.requestCooldownSeconds || 0)) * 1000
  const maxAttempts = Math.max(1, Number(fastify.config.passwordReset?.maxAttempts || 5))

  const generateOpaqueToken = () => {
    const id = crypto.randomUUIDv7()
    const secret = crypto.randomBytes(32).toString('hex')
    return { id, secret }
  }

  const hashSecret = (secret) => {
    return crypto.createHash('sha256').update(secret).digest('hex')
  }

  const buildEmailMarker = (email) => {
    return crypto
      .createHash('sha256')
      .update(String(email).trim().toLowerCase())
      .digest('hex')
      .slice(0, 12)
  }

  const getResetFailureReason = (resetData) => {
    if (!resetData || !resetData.passwordReset?.secretHash) {
      return 'not_found'
    }

    if (
      resetData.passwordReset.expiresAt instanceof Date &&
      !Number.isNaN(resetData.passwordReset.expiresAt.getTime()) &&
      compareInstants(instantFromDate(resetData.passwordReset.expiresAt), nowInstant()) <= 0
    ) {
      return 'expired'
    }

    if ((resetData.passwordReset.failedAttempts ?? 0) >= maxAttempts) {
      return 'max_attempts_exceeded'
    }

    return null
  }

  const auditValidationFailure = ({
    request,
    phase,
    resetId,
    resetData,
    reason,
    failedAttempts,
  }) => {
    const details = { phase, reason }
    if (typeof failedAttempts === 'number') {
      details.failedAttempts = failedAttempts
    }

    fastify.auditLog({
      request,
      action: 'auth_password_reset_validation_failed',
      userId: resetData?._id,
      resourceType: 'password_reset',
      resourceId: resetId,
      details,
    })
  }

  const passwordResetServiceApi = {
    async requestReset({ request, email }) {
      // Validate user existence passively no leak via UI
      const user = await fastify.usersDataSource.readUserForPasswordReset(email)
      if (!user) {
        fastify.auditLog({
          request,
          action: 'auth_password_reset_request_ignored',
          resourceType: 'user',
          resourceId: null,
          details: {
            reason: 'user_not_found',
            emailMarker: buildEmailMarker(email),
          },
        })
        return false
      }

      if (
        requestCooldownMs > 0 &&
        user.passwordReset?.requestedAt instanceof Date &&
        !Number.isNaN(user.passwordReset.requestedAt.getTime())
      ) {
        const currentInstant = nowInstant()
        const cooldownEndsAt = addInstantDuration(instantFromDate(user.passwordReset.requestedAt), {
          milliseconds: requestCooldownMs,
        })

        if (compareInstants(cooldownEndsAt, currentInstant) > 0) {
          fastify.auditLog({
            request,
            action: 'auth_password_reset_request_ignored',
            userId: user._id,
            resourceType: 'user',
            resourceId: user._id,
            details: { reason: 'cooldown_active' },
          })
          return false
        }
      }

      // Generate secure atomic token
      const { id, secret } = generateOpaqueToken()
      const secretHash = hashSecret(secret)
      const requestedAtInstant = nowInstant()
      const expiresAtInstant = addInstantDuration(requestedAtInstant, { minutes: ttlMinutes })
      const requestedAt = instantToDate(requestedAtInstant)
      const expiresAt = instantToDate(expiresAtInstant)

      // Atomically embed to User document
      const initiated = await fastify.usersDataSource.initiatePasswordReset(
        user._id,
        id,
        secretHash,
        requestedAt,
        expiresAt,
      )
      if (!initiated) {
        fastify.auditLog({
          request,
          action: 'auth_password_reset_request_ignored',
          userId: user._id,
          resourceType: 'user',
          resourceId: user._id,
          details: { reason: 'user_unavailable' },
        })
        return false
      }

      // Construct URL and send email
      const resetToken = `${id}.${secret}`
      const resetUrl = `${frontendBaseUrl}/reset-password/confirm#token=${encodeURIComponent(resetToken)}`

      try {
        await fastify.mailer.sendPasswordResetMail({ to: user.email, rawResetUrl: resetUrl })
        fastify.auditLog({
          request,
          action: 'auth_password_reset_requested',
          userId: user._id,
          resourceType: 'user',
          resourceId: user._id,
        })
        return true
      } catch (err) {
        // Rollback atomic DB state so usrs aren't locked out of trying again
        fastify.log.error(
          { err, userId: user._id, emailMarker: buildEmailMarker(email) },
          'Could not dispatch reset email, rolling back reset state.',
        )
        try {
          await fastify.usersDataSource.rescindPasswordReset(id)
        } catch (rollbackError) {
          fastify.log.error(
            { err: rollbackError, userId: user._id, resetId: id },
            'Could not rollback password reset state after email failure.',
          )
        }

        fastify.auditLog({
          request,
          action: 'auth_password_reset_mail_failed',
          userId: user._id,
          resourceType: 'user',
          resourceId: user._id,
          details: { phase: 'request' },
        })
        return false
      }
    },

    async validateToken({ request, resetId, rawSecret }) {
      const resetData = await fastify.usersDataSource.checkPasswordResetExists(resetId)

      const failureReason = getResetFailureReason(resetData)
      if (failureReason) {
        auditValidationFailure({
          request,
          phase: 'validate',
          resetId,
          resetData,
          reason: failureReason,
        })
        return false
      }

      const incomingHash = hashSecret(rawSecret)
      const isValid = crypto.timingSafeEqual(
        Buffer.from(incomingHash, 'hex'),
        Buffer.from(resetData.passwordReset.secretHash, 'hex'),
      )

      if (isValid) {
        return true
      }

      const failedResetData = await fastify.usersDataSource.incrementPasswordResetFailedAttempts(
        resetId,
        maxAttempts,
      )
      auditValidationFailure({
        request,
        phase: 'validate',
        resetId,
        resetData: failedResetData || resetData,
        reason: 'invalid_secret',
        failedAttempts:
          failedResetData?.passwordReset?.failedAttempts ??
          Math.min((resetData.passwordReset.failedAttempts ?? 0) + 1, maxAttempts),
      })

      return false
    },

    async executeReset({ request, resetId, rawSecret, newPassword }) {
      const resetData = await fastify.usersDataSource.checkPasswordResetExists(resetId)
      const failureReason = getResetFailureReason(resetData)

      if (failureReason) {
        auditValidationFailure({
          request,
          phase: 'confirm',
          resetId,
          resetData,
          reason: failureReason,
        })
        return false
      }

      const secretHash = hashSecret(rawSecret)

      if (
        !crypto.timingSafeEqual(
          Buffer.from(secretHash, 'hex'),
          Buffer.from(resetData.passwordReset.secretHash, 'hex'),
        )
      ) {
        const failedResetData = await fastify.usersDataSource.incrementPasswordResetFailedAttempts(
          resetId,
          maxAttempts,
        )
        auditValidationFailure({
          request,
          phase: 'confirm',
          resetId,
          resetData: failedResetData || resetData,
          reason: 'invalid_secret',
          failedAttempts:
            failedResetData?.passwordReset?.failedAttempts ??
            Math.min((resetData.passwordReset.failedAttempts ?? 0) + 1, maxAttempts),
        })
        return false
      }

      const newPasswordHash = await hashPassword(newPassword)

      try {
        const user = await fastify.usersDataSource.verifyAndExecutePasswordReset(
          resetId,
          secretHash,
          newPasswordHash,
          maxAttempts,
        )
        if (!user) {
          auditValidationFailure({
            request,
            phase: 'confirm',
            resetId,
            resetData,
            reason: 'consumed_or_invalidated',
          })
          return false
        }

        fastify.auditLog({
          request,
          action: 'auth_password_reset_confirmed',
          userId: user._id,
          resourceType: 'user',
          resourceId: user._id,
        })

        // Fire async confirmation email
        setImmediate(() => {
          fastify.mailer.sendPasswordResetSuccessMail({ to: user.email }).catch((err) => {
            fastify.log.warn(
              { err, userId: user._id },
              'Could not send reset confirmation email, but password was reset.',
            )
          })
        })

        return true
      } catch (error) {
        // Handle race conditions or edge cases gracefully
        fastify.log.warn({ error, resetId }, 'Atomic reset failed during execution phase')
        auditValidationFailure({
          request,
          phase: 'confirm',
          resetId,
          resetData,
          reason: 'execution_failed',
        })
        return false
      }
    },
  }

  fastify.decorate('passwordResetService', passwordResetServiceApi)
}

module.exports = fp(passwordResetPlugin, {
  name: 'password-reset-plugin',
  dependencies: ['application-config', 'users-store', 'mailer-plugin', 'audit-plugin'],
  decorators: {
    fastify: ['config', 'usersDataSource', 'mailer', 'auditLog'],
  },
})
