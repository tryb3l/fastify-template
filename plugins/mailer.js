'use strict'

const fp = require('fastify-plugin')
const nodemailer = require('nodemailer')

const sentMessages = []

function createMissingSmtpConfigError() {
  const error = new Error('SMTP configuration is required outside development and test modes')
  error.code = 'SMTP_CONFIG_REQUIRED'
  return error
}

function getTestMessages() {
  return sentMessages.map((message) => ({ ...message }))
}

function clearTestMessages() {
  sentMessages.length = 0
}

/**
 * Fastify Mailer Plugin
 *
 * Exposes a structured API for sending emails safely without blocking event loops.
 * Uses a local capture transport in tests and requires SMTP in non-test environments.
 *
 * @example
 * // Usage in routes/services:
 * await fastify.mailer.sendPasswordResetMail({
 *   to: 'user@example.com',
 *   rawResetUrl: 'https://frontend.url/reset-password?token=...'
 * })
 */
async function mailerPlugin(fastify) {
  fastify.log.info('Starting registration of mailer plugin')

  const { smtp, fromEmail } = fastify.config.mailer || {}
  const isTestEnv = fastify.config.NODE_ENV === 'test'
  const isDevelopmentEnv = fastify.config.NODE_ENV === 'development'
  const hasSmtpConfig = Boolean(smtp?.host)
  const useCaptureTransport = (isTestEnv || isDevelopmentEnv) && !hasSmtpConfig
  let transporter

  if (!hasSmtpConfig) {
    if (!useCaptureTransport) {
      throw createMissingSmtpConfigError()
    }

    fastify.log.warn(
      { env: fastify.config.NODE_ENV },
      'No SMTP credentials found. Using local capture transport.',
    )
    transporter = nodemailer.createTransport({
      streamTransport: true,
      newline: 'unix',
      buffer: true,
    })
  } else {
    transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure !== false,
      auth: {
        user: smtp.user,
        pass: smtp.pass,
      },
    })
  }

  const sendMail = async (mailOptions) => {
    try {
      const info = await transporter.sendMail(mailOptions)
      if (useCaptureTransport) {
        sentMessages.push({
          from: mailOptions.from,
          to: mailOptions.to,
          subject: mailOptions.subject,
          text: mailOptions.text,
          html: mailOptions.html,
        })
      }

      if (info.messageUrl) {
        fastify.log.info({ url: info.messageUrl }, 'Preview email')
      }
      return info
    } catch (err) {
      fastify.log.error({ err }, 'Failed to send email')
      throw err // Let the caller decide how to handle or rollback
    }
  }

  const mailerApi = {
    async sendPasswordResetMail({ to, rawResetUrl }) {
      return await sendMail({
        from: `"Security Team" <${fromEmail || 'no-reply@example.com'}>`,
        to,
        subject: 'Password Reset Request',
        text: `You have requested a password reset. Please click on the following link or paste it into your browser to complete the process:\n\n${rawResetUrl}\n\nIf you did not request this, please ignore this email and your password will remain unchanged.`,
        html: `<p>You have requested a password reset.</p><p>Please <a href="${rawResetUrl}">click here</a> to complete the process.</p><p>If you did not request this, please ignore this email.</p>`,
      })
    },

    async sendPasswordResetSuccessMail({ to }) {
      return await sendMail({
        from: `"Security Team" <${fromEmail || 'no-reply@example.com'}>`,
        to,
        subject: 'Your password has been changed',
        text: `Hello,\n\nThis is a confirmation that the password for your account has just been changed.\n`,
        html: `<p>Hello,</p><p>This is a confirmation that the password for your account has just been changed.</p>`,
      })
    },

    async sendInviteMail({ to, inviteToken, role = 'user', expiresAt }) {
      const frontendBaseUrl = String(fastify.config?.FRONTEND_URL || '')
        .split(',')[0]
        .trim()
        .replace(/\/+$/, '')
      const inviteUrl = `${frontendBaseUrl}/register?inviteToken=${encodeURIComponent(inviteToken)}`
      const expiryStr =
        expiresAt instanceof Date ? expiresAt.toISOString() : String(expiresAt || '')

      return await sendMail({
        from: `"Workspace Team" <${fromEmail || 'no-reply@example.com'}>`,
        to,
        subject: 'You have been invited to join the workspace',
        text: `You have been invited to join the workspace with role "${role}".\n\nUse the following link or invitation token to register before ${expiryStr}:\n\n${inviteUrl}\n\nInvitation token: ${inviteToken}`,
        html: `<p>You have been invited to join the workspace with role <strong>${role}</strong>.</p><p><a href="${inviteUrl}">Accept Invitation</a></p><p>Invitation token: <code>${inviteToken}</code></p><p>Expires at: ${expiryStr}</p>`,
      })
    },

    async sendEmailVerificationMail({ to, rawVerifyUrl, token }) {
      return await sendMail({
        from: `"Security Team" <${fromEmail || 'no-reply@example.com'}>`,
        to,
        subject: 'Verify your email address',
        text: `Please verify your email address by visiting the following link:\n\n${rawVerifyUrl}\n\nVerification token: ${token}`,
        html: `<p>Please verify your email address by clicking the link below:</p><p><a href="${rawVerifyUrl}">Verify Email</a></p><p>Verification token: <code>${token}</code></p>`,
      })
    },

    getTestMessages() {
      return getTestMessages()
    },

    clearTestMessages() {
      clearTestMessages()
    },
  }

  fastify.decorate('mailer', mailerApi)
  fastify.log.info('Successfully registered mailer plugin')
}

module.exports = fp(mailerPlugin, {
  name: 'mailer-plugin',
  dependencies: ['application-config'],
  decorators: {
    fastify: ['config'],
  },
})

module.exports.getTestMessages = getTestMessages
module.exports.clearTestMessages = clearTestMessages
