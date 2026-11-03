'use strict'

const fp = require('fastify-plugin')
const crypto = require('node:crypto')
const { randomUUIDv7 } = crypto
const { addInstantDuration, instantToDate, nowInstant } = require('../utils/time')
const {
  USER_AUTH_SESSION_PROJECTION,
  USER_AUTH_WITH_HASH_PROJECTION,
  USER_DETAIL_PROJECTION,
} = require('../routes/users/user-contract')

const USER_CACHE_TTL_MS = 300_000

function buildUserCacheKey(userId) {
  return `user:${userId}`
}

function normalizeIdentifier(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : value
}

function normalizePublicUser(user) {
  if (!user) return null
  const id = String(user.id || user._id)
  return {
    id,
    username: user.username,
    email: user.email,
    emailVerified: Boolean(user.emailVerified),
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    createdAt: user.createdAt,
    modifiedAt: user.modifiedAt,
  }
}

async function usersPlugin(fastify) {
  const users = fastify.mongo.db.collection('users')
  const revokedTokens = fastify.mongo.db.collection('revokedTokens')
  const userInvites = fastify.mongo.db.collection('userInvites')
  const notes = fastify.mongo.db.collection('notes')
  const folders = fastify.mongo.db.collection('folders')
  const notebooks = fastify.mongo.db.collection('notebooks')
  const flashcards = fastify.mongo.db.collection('flashcards')
  const dailyActivity = fastify.mongo.db.collection('dailyActivity')
  const syncTombstones = fastify.mongo.db.collection('syncTombstones')
  const getFindOneAndUpdateValue = (result) => {
    return result && typeof result === 'object' && 'value' in result ? result.value : result
  }

  function hashInviteSecret(secret) {
    return crypto.createHash('sha256').update(String(secret)).digest('hex')
  }

  async function invalidateUserCache(userId) {
    if (typeof fastify.cacheDelete !== 'function' || !userId) {
      return
    }
    try {
      await fastify.cacheDelete(buildUserCacheKey(userId))
    } catch (err) {
      fastify.log.warn({ err, userId }, 'Failed to invalidate user cache key')
    }
  }

  const usersDataSource = {
    async createUser(userData) {
      fastify.log.info('Entering createUser method')
      const _id = randomUUIDv7()
      const now = instantToDate(nowInstant())
      const documentToInsert = {
        ...userData,
        _id,
        id: _id,
        username: normalizeIdentifier(userData.username),
        email: normalizeIdentifier(userData.email),
        emailVerified: Boolean(userData.emailVerified),
        createdAt: now,
        modifiedAt: now,
        role: userData.role || 'user',
        credentialsVersion: 0,
      }
      try {
        const result = await users.insertOne(documentToInsert)
        fastify.log.info('Exiting createUser method')
        return result.insertedId
      } catch (error) {
        if (error.code === 11000) {
          throw fastify.httpErrors.conflict('User already registered')
        }
        fastify.log.error({ error }, 'Error creating user')
        throw error
      }
    },

    async readUser(identifier) {
      fastify.log.info('Entering readUser method')
      const normalized = normalizeIdentifier(identifier)
      try {
        const user = await users.findOne(
          { $or: [{ username: normalized }, { email: normalized }], deleted: { $ne: true } },
          {
            projection: {
              _id: 1,
              id: 1,
              username: 1,
              email: 1,
              role: 1,
              deleted: 1,
              createdAt: 1,
              modifiedAt: 1,
              credentialsVersion: 1,
            },
          },
        )
        fastify.log.info('Exiting readUser method')
        return user ? { ...user, id: String(user.id || user._id) } : null
      } catch (error) {
        fastify.log.error({ error }, 'Error reading user')
        throw error
      }
    },

    async readUserForPasswordReset(email) {
      fastify.log.info('Entering readUserForPasswordReset method')
      const normalizedEmail = normalizeIdentifier(email)
      try {
        const user = await users.findOne(
          { email: normalizedEmail, deleted: { $ne: true } },
          {
            projection: {
              _id: 1,
              id: 1,
              email: 1,
              'passwordReset.id': 1,
              'passwordReset.requestedAt': 1,
              'passwordReset.expiresAt': 1,
              'passwordReset.failedAttempts': 1,
            },
          },
        )
        fastify.log.info('Exiting readUserForPasswordReset method')
        return user
      } catch (error) {
        fastify.log.error({ error }, 'Error reading user for password reset')
        throw error
      }
    },

    async readUserWithHash(identifier) {
      fastify.log.info('Entering readUserWithHash method')
      const normalized = normalizeIdentifier(identifier)
      try {
        const user = await users.findOne(
          { $or: [{ username: normalized }, { email: normalized }], deleted: { $ne: true } },
          {
            projection: USER_AUTH_WITH_HASH_PROJECTION,
          },
        )
        fastify.log.info('Exiting readUserWithHash method')
        return user ? { ...user, id: String(user.id || user._id) } : null
      } catch (error) {
        fastify.log.error({ error }, 'Error reading user with hash')
        throw error
      }
    },

    async listUsers({ filter = {}, skip = 0, limit = 10 } = {}) {
      fastify.log.info('Entering listUsers method')
      try {
        const normalizedFilter = { ...filter }
        if (typeof normalizedFilter.username === 'string') {
          normalizedFilter.username = normalizeIdentifier(normalizedFilter.username)
        }
        const queryFilter = { ...normalizedFilter, deleted: { $ne: true } }
        const usersList = await users
          .find(queryFilter, {
            projection: USER_DETAIL_PROJECTION,
          })
          .skip(skip)
          .limit(limit)
          .toArray()
        fastify.log.info('Exiting listUsers method')
        return usersList.map(normalizePublicUser)
      } catch (error) {
        fastify.log.error({ error }, 'Error listing users')
        throw error
      }
    },

    async countUsers({ filter = {} } = {}) {
      fastify.log.info('Entering countUsers method')
      try {
        const normalizedFilter = { ...filter }
        if (typeof normalizedFilter.username === 'string') {
          normalizedFilter.username = normalizeIdentifier(normalizedFilter.username)
        }
        const queryFilter = { ...normalizedFilter, deleted: { $ne: true } }
        const count = await users.countDocuments(queryFilter)
        fastify.log.info('Exiting countUsers method')
        return count
      } catch (error) {
        fastify.log.error({ error }, 'Error counting users')
        throw error
      }
    },

    async readUserDetails(id) {
      fastify.log.info('Entering readUserDetails method')
      try {
        const user = await users.findOne(
          { _id: id, deleted: { $ne: true } },
          {
            projection: USER_DETAIL_PROJECTION,
          },
        )
        fastify.log.info('Exiting readUserDetails method')
        return normalizePublicUser(user)
      } catch (error) {
        fastify.log.error({ error }, 'Error reading user details')
        throw error
      }
    },

    async readUserById(id) {
      fastify.log.info('Entering readUserById method')
      const useCache = typeof fastify.cacheGet === 'function' && Boolean(id)
      const cacheKey = useCache ? buildUserCacheKey(id) : null

      if (useCache) {
        const cached = await fastify.cacheGet(cacheKey)
        if (cached && cached.item) {
          fastify.log.info('User cache HIT - Serving from RAM')
          return cached.item
        }
      }

      try {
        const user = await users.findOne(
          { _id: id, deleted: { $ne: true } },
          {
            projection: USER_AUTH_SESSION_PROJECTION,
          },
        )
        if (user) {
          user.id = String(user.id || user._id)
          if (useCache && typeof fastify.cacheSet === 'function') {
            await fastify.cacheSet(cacheKey, user, USER_CACHE_TTL_MS)
          }
        }
        fastify.log.info('Exiting readUserById method')
        return user
      } catch (error) {
        fastify.log.error(
          { error, id },
          'Failed to read user by ID due to Database availability anomaly',
        )
        throw error
      }
    },

    async updateUser(id, newUser) {
      fastify.log.info('Entering updateUser method')
      const normalizedUpdate = { ...newUser }
      if (typeof normalizedUpdate.username === 'string') {
        normalizedUpdate.username = normalizeIdentifier(normalizedUpdate.username)
      }
      if (typeof normalizedUpdate.email === 'string') {
        normalizedUpdate.email = normalizeIdentifier(normalizedUpdate.email)
      }

      const uniquenessOrClauses = []
      if (normalizedUpdate.username) {
        uniquenessOrClauses.push({ username: normalizedUpdate.username })
      }
      if (normalizedUpdate.email) {
        uniquenessOrClauses.push({ email: normalizedUpdate.email })
      }
      if (uniquenessOrClauses.length > 0) {
        const duplicateUser = await users.findOne(
          {
            _id: { $ne: id },
            deleted: { $ne: true },
            $or: uniquenessOrClauses,
          },
          { projection: { _id: 1 } },
        )
        if (duplicateUser) {
          throw fastify.httpErrors.conflict('Username or email already in use')
        }
      }

      const hasEmailChange = Object.hasOwn(normalizedUpdate, 'email')
      const shouldIncrementCredentials = hasEmailChange || Object.hasOwn(normalizedUpdate, 'hash')

      if (hasEmailChange) {
        normalizedUpdate.emailVerified = false
      }

      const updateDoc = {
        $set: {
          ...normalizedUpdate,
          modifiedAt: instantToDate(nowInstant()),
        },
      }

      if (hasEmailChange) {
        updateDoc.$unset = { emailVerification: '' }
      }

      if (shouldIncrementCredentials) {
        updateDoc.$inc = { credentialsVersion: 1 }
      }

      try {
        const result = await users.updateOne({ _id: id, deleted: { $ne: true } }, updateDoc)
        await invalidateUserCache(id)
        fastify.log.info('Exiting updateUser method')
        return result
      } catch (error) {
        if (error.code === 11000) {
          throw fastify.httpErrors.conflict('Username or email already in use')
        }
        fastify.log.error({ error, id }, 'Error updating user')
        throw error
      }
    },

    async deleteUser(id) {
      fastify.log.info('Entering deleteUser method')
      try {
        const now = instantToDate(nowInstant())
        const res = await users.updateOne(
          { _id: id, deleted: { $ne: true } },
          {
            $set: {
              deleted: true,
              deletedAt: now,
              modifiedAt: now,
              username: `deleted:${id}`,
              email: `deleted+${id}@deleted.invalid`,
            },
            $unset: {
              hash: '',
              firstName: '',
              lastName: '',
              passwordReset: '',
              emailVerification: '',
            },
            $inc: { credentialsVersion: 1 },
          },
        )

        if (res.modifiedCount === 0) {
          fastify.log.info(
            { userId: id },
            "User for delete does not exist or user can't be deleted",
          )
          return false
        }

        await invalidateUserCache(id)

        // Purge any physical attachments owned by the user's notes
        const notesWithAttachments = await notes
          .find(
            { userId: id, 'attachments.0': { $exists: true } },
            { projection: { _id: 0, attachments: 1 } },
          )
          .toArray()

        if (notesWithAttachments.length > 0 && fastify.notesFileManager) {
          const allAttachments = notesWithAttachments.flatMap((n) => n.attachments || [])
          if (allAttachments.length > 0) {
            await fastify.notesFileManager.deleteNoteAttachments(allAttachments)
          }
        }

        await Promise.all([
          notes.deleteMany({ userId: id }),
          folders.deleteMany({ userId: id }),
          notebooks.deleteMany({ userId: id }),
          flashcards.deleteMany({ userId: id }),
          dailyActivity.deleteMany({ userId: id }),
          syncTombstones.deleteMany({ userId: id }),
          this.deleteRevokedTokens(id),
        ])

        fastify.log.info('Exiting deleteUser method')
        return true
      } catch (error) {
        fastify.log.error({ error, id }, 'Error deleting user')
        throw error
      }
    },

    async createInvite({ email = null, role = 'user', ttlHours, createdBy }) {
      const id = randomUUIDv7()
      const rawSecret = crypto.randomBytes(32).toString('hex')
      const secretHash = hashInviteSecret(rawSecret)
      const now = nowInstant()
      const effectiveTtlHours = Math.max(
        1,
        Number(ttlHours || fastify.config?.INVITE_TTL_HOURS || 168),
      )
      const createdAt = instantToDate(now)
      const expiresAt = instantToDate(addInstantDuration(now, { hours: effectiveTtlHours }))
      const normalizedEmail = email ? normalizeIdentifier(email) : null

      const doc = {
        _id: id,
        id,
        secretHash,
        email: normalizedEmail,
        role: role || 'user',
        createdBy,
        createdAt,
        expiresAt,
        consumedAt: null,
        consumedBy: null,
      }

      await userInvites.insertOne(doc)

      return {
        id,
        inviteToken: `${id}.${rawSecret}`,
        email: normalizedEmail,
        role: doc.role,
        createdBy,
        createdAt,
        expiresAt,
        consumedAt: null,
        consumedBy: null,
      }
    },

    async listInvites() {
      const list = await userInvites
        .find({}, { projection: { _id: 0, secretHash: 0 } })
        .sort({ createdAt: -1 })
        .toArray()
      return list
    },

    async revokeInvite(id) {
      const res = await userInvites.deleteOne({ _id: id })
      return res.deletedCount === 1
    },

    async verifyInviteToken(inviteToken, candidateEmail) {
      if (typeof inviteToken !== 'string' || !inviteToken.includes('.')) {
        return null
      }
      const dotIndex = inviteToken.indexOf('.')
      const inviteId = inviteToken.slice(0, dotIndex)
      const rawSecret = inviteToken.slice(dotIndex + 1)
      if (!inviteId || !rawSecret) {
        return null
      }

      const now = instantToDate(nowInstant())
      const invite = await userInvites.findOne({
        _id: inviteId,
        consumedAt: null,
        expiresAt: { $gt: now },
      })

      if (!invite || !invite.secretHash) {
        return null
      }

      const incomingHash = hashInviteSecret(rawSecret)
      const incomingBuf = Buffer.from(incomingHash, 'hex')
      const storedBuf = Buffer.from(invite.secretHash, 'hex')

      if (
        incomingBuf.length !== storedBuf.length ||
        !crypto.timingSafeEqual(incomingBuf, storedBuf)
      ) {
        return null
      }

      const normalizedCandidateEmail = normalizeIdentifier(candidateEmail)
      if (invite.email && invite.email !== normalizedCandidateEmail) {
        return null
      }

      return invite
    },

    async consumeInvite(inviteId, consumedByUserId) {
      const now = instantToDate(nowInstant())
      const res = await userInvites.updateOne(
        { _id: inviteId, consumedAt: null, expiresAt: { $gt: now } },
        { $set: { consumedAt: now, consumedBy: consumedByUserId } },
      )
      return res.modifiedCount === 1
    },

    async checkIfRevoked(jti) {
      fastify.log.info('Entering checkIfRevoked method')
      try {
        const token = await revokedTokens.findOne({ _id: jti }, { projection: { _id: 1 } })
        fastify.log.info('Exiting checkIfRevoked method')
        return token !== null
      } catch (error) {
        fastify.log.error({ error, jti }, 'Database check revoke failure')
        throw error
      }
    },

    async revokeToken(jti, exp, userId) {
      fastify.log.info('Entering revokeToken method')
      try {
        const expirationDate = new Date(exp * 1000)

        await revokedTokens.insertOne({
          _id: jti,
          userId: userId,
          expiresAt: expirationDate,
        })

        fastify.log.info({ jti }, 'Token added to TTL blocklist')
      } catch (error) {
        if (error.code === 11000) {
          fastify.log.info({ jti }, 'Token was already revoked')
          return
        }
        fastify.log.error({ error, jti }, 'Database failure on token revoke')
        throw error
      }
    },

    async deleteRevokedTokens(userId) {
      fastify.log.info('Entering deleteRevokedTokens method')
      try {
        const deleteResult = await revokedTokens.deleteMany({ userId })
        fastify.log.info(
          { userId, result: deleteResult },
          'Tokens removed (many on specific user id) on DB/Store',
        )
        fastify.log.info('Exiting deleteRevokedTokens method')
      } catch (error) {
        fastify.log.error({ error, userId }, 'Error on bulk token revoke status')
        throw error
      }
    },

    async initiatePasswordReset(userId, resetId, secretHash, requestedAt, expiresAt) {
      fastify.log.info({ userId, resetId }, 'Entering initiatePasswordReset method')
      const result = await users.updateOne(
        { _id: userId, deleted: { $ne: true } },
        {
          $set: {
            passwordReset: {
              id: resetId,
              secretHash,
              requestedAt,
              expiresAt,
              failedAttempts: 0,
            },
          },
        },
      )
      fastify.log.info('Exiting initiatePasswordReset method')
      return result.modifiedCount === 1
    },

    async verifyAndExecutePasswordReset(resetId, secretHash, newHash, maxAttempts) {
      fastify.log.info({ resetId }, 'Entering verifyAndExecutePasswordReset method')

      const now = instantToDate(nowInstant())
      const result = await users.findOneAndUpdate(
        {
          'passwordReset.id': resetId,
          'passwordReset.secretHash': secretHash,
          'passwordReset.expiresAt': { $gt: now },
          $or: [
            { 'passwordReset.failedAttempts': { $exists: false } },
            { 'passwordReset.failedAttempts': { $lt: maxAttempts } },
          ],
          deleted: { $ne: true },
        },
        {
          $set: {
            hash: newHash,
            modifiedAt: now,
            passwordChangedAt: now,
          },
          $inc: { credentialsVersion: 1 },
          $unset: { passwordReset: '' },
        },
        {
          projection: { _id: 1, email: 1 },
          returnDocument: 'before',
        },
      )

      const user = getFindOneAndUpdateValue(result)
      if (user?._id) {
        await invalidateUserCache(user._id)
      }

      fastify.log.info('Exiting verifyAndExecutePasswordReset method')
      return user
    },

    async incrementPasswordResetFailedAttempts(resetId, maxAttempts) {
      fastify.log.info({ resetId }, 'Entering incrementPasswordResetFailedAttempts method')

      const now = instantToDate(nowInstant())
      const result = await users.findOneAndUpdate(
        {
          'passwordReset.id': resetId,
          $or: [
            { 'passwordReset.failedAttempts': { $exists: false } },
            { 'passwordReset.failedAttempts': { $lt: maxAttempts } },
          ],
          deleted: { $ne: true },
        },
        {
          $inc: { 'passwordReset.failedAttempts': 1 },
          $set: { modifiedAt: now },
        },
        {
          projection: {
            _id: 1,
            email: 1,
            'passwordReset.id': 1,
            'passwordReset.expiresAt': 1,
            'passwordReset.failedAttempts': 1,
          },
          returnDocument: 'after',
        },
      )

      const user = getFindOneAndUpdateValue(result)

      fastify.log.info('Exiting incrementPasswordResetFailedAttempts method')
      return user
    },

    async rescindPasswordReset(resetId) {
      await users.updateOne(
        { 'passwordReset.id': resetId },
        {
          $set: { modifiedAt: instantToDate(nowInstant()) },
          $unset: { passwordReset: '' },
        },
      )
    },

    async checkPasswordResetExists(resetId) {
      return await users.findOne(
        {
          'passwordReset.id': resetId,
          deleted: { $ne: true },
        },
        {
          projection: {
            _id: 1,
            email: 1,
            'passwordReset.id': 1,
            'passwordReset.secretHash': 1,
            'passwordReset.expiresAt': 1,
            'passwordReset.failedAttempts': 1,
          },
        },
      )
    },

    async initiateEmailVerification({ userId, email }) {
      const filter = { deleted: { $ne: true } }
      if (userId) {
        filter._id = userId
      } else if (email) {
        filter.email = normalizeIdentifier(email)
      } else {
        return null
      }

      const user = await users.findOne(filter, {
        projection: { _id: 1, id: 1, email: 1, emailVerified: 1 },
      })
      if (!user || user.emailVerified === true) {
        return null
      }

      const verificationId = randomUUIDv7()
      const rawSecret = crypto.randomBytes(32).toString('hex')
      const secretHash = hashInviteSecret(rawSecret)
      const now = nowInstant()
      const requestedAt = instantToDate(now)
      const expiresAt = instantToDate(addInstantDuration(now, { hours: 24 }))

      const updated = await users.updateOne(
        { _id: user._id, deleted: { $ne: true } },
        {
          $set: {
            emailVerification: {
              id: verificationId,
              secretHash,
              requestedAt,
              expiresAt,
            },
          },
        },
      )

      if (updated.modifiedCount === 0) {
        return null
      }

      return {
        userId: String(user.id || user._id),
        email: user.email,
        token: `${verificationId}.${rawSecret}`,
        expiresAt,
      }
    },

    async confirmEmailVerification({ token, email = null }) {
      if (typeof token !== 'string' || !token.includes('.')) {
        return null
      }
      const dotIndex = token.indexOf('.')
      const verificationId = token.slice(0, dotIndex)
      const rawSecret = token.slice(dotIndex + 1)
      if (!verificationId || !rawSecret) {
        return null
      }

      const incomingHash = hashInviteSecret(rawSecret)
      const filter = {
        'emailVerification.id': verificationId,
        deleted: { $ne: true },
      }
      if (email) {
        filter.email = normalizeIdentifier(email)
      }

      const now = instantToDate(nowInstant())
      const user = await users.findOne(filter, {
        projection: {
          _id: 1,
          id: 1,
          email: 1,
          emailVerification: 1,
        },
      })

      if (
        !user ||
        !user.emailVerification?.secretHash ||
        !(user.emailVerification.expiresAt instanceof Date) ||
        user.emailVerification.expiresAt <= now
      ) {
        return null
      }

      const incomingBuf = Buffer.from(incomingHash, 'hex')
      const storedBuf = Buffer.from(user.emailVerification.secretHash, 'hex')
      if (
        incomingBuf.length !== storedBuf.length ||
        !crypto.timingSafeEqual(incomingBuf, storedBuf)
      ) {
        return null
      }

      const res = await users.findOneAndUpdate(
        {
          _id: user._id,
          'emailVerification.id': verificationId,
          'emailVerification.secretHash': incomingHash,
          'emailVerification.expiresAt': { $gt: now },
          deleted: { $ne: true },
        },
        {
          $set: {
            emailVerified: true,
            modifiedAt: now,
          },
          $unset: { emailVerification: '' },
        },
        {
          projection: USER_DETAIL_PROJECTION,
          returnDocument: 'after',
        },
      )

      const verifiedUser = getFindOneAndUpdateValue(res)
      if (verifiedUser) {
        await invalidateUserCache(String(verifiedUser.id || verifiedUser._id))
      }

      return normalizePublicUser(verifiedUser)
    },
  }

  fastify.decorate('usersDataSource', usersDataSource)
  fastify.log.info('Successfully registered users plugin')
}

module.exports = fp(usersPlugin, {
  name: 'users-store',
  dependencies: ['db-plugin', 'app-cache'],
  decorators: {
    fastify: ['mongo'],
  },
})
