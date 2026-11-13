'use strict'

const fp = require('fastify-plugin')
const { instantToDate, nowInstant } = require('../utils/time')

const DAY_MS = 86_400_000
const HEATMAP_DAYS_COUNT = 84
const VELOCITY_DAYS_COUNT = 14

function toUtcDateKey(date) {
  return date.toISOString().slice(0, 10)
}

function buildUtcDateRangeEndingAt(endDate, count) {
  const endUtcMidnight = Date.UTC(
    endDate.getUTCFullYear(),
    endDate.getUTCMonth(),
    endDate.getUTCDate(),
  )
  const dates = new Array(count)
  for (let i = 0; i < count; i += 1) {
    const dayOffset = count - 1 - i
    dates[i] = toUtcDateKey(new Date(endUtcMidnight - dayOffset * DAY_MS))
  }
  return dates
}

function computeReadinessSummary(directNotes, externalNotes = null) {
  let toReviewCount = 0
  let inProgressCount = 0
  let masteredCount = 0

  for (let i = 0; i < directNotes.length; i += 1) {
    const note = directNotes[i]
    if (!note || note.noteType === 'post_mortem') {
      continue
    }
    const readiness = note.readiness || 'to_review'
    if (readiness === 'mastered') {
      masteredCount += 1
    } else if (readiness === 'in_progress') {
      inProgressCount += 1
    } else {
      toReviewCount += 1
    }
  }

  if (Array.isArray(externalNotes)) {
    for (let i = 0; i < externalNotes.length; i += 1) {
      const note = externalNotes[i]
      if (!note || note.noteType === 'post_mortem') {
        continue
      }
      const readiness = note.readiness || 'to_review'
      if (readiness === 'mastered') {
        masteredCount += 1
      } else if (readiness === 'in_progress') {
        inProgressCount += 1
      } else {
        toReviewCount += 1
      }
    }
  }

  const totalCount = toReviewCount + inProgressCount + masteredCount
  if (totalCount === 0) {
    return {
      toReviewCount: 0,
      inProgressCount: 0,
      masteredCount: 0,
      totalCount: 0,
      scorePercent: 0,
      blocks: 0,
    }
  }

  const weightedSum = masteredCount * 1.0 + inProgressCount * 0.5
  const scorePercent = Math.round((weightedSum / totalCount) * 100)
  const blocks = Math.round(scorePercent / 10)

  return {
    toReviewCount,
    inProgressCount,
    masteredCount,
    totalCount,
    scorePercent,
    blocks,
  }
}

module.exports = fp(
  async function dailyActivityStorePlugin(fastify) {
    fastify.log.info('Starting registration of daily-activity-store plugin')

    const dailyActivity = fastify.mongo.db.collection('dailyActivity')
    const notebooks = fastify.mongo.db.collection('notebooks')
    const notes = fastify.mongo.db.collection('notes')
    const flashcards = fastify.mongo.db.collection('flashcards')

    async function recordDailyActivity(userId, increments = {}, atDate = null) {
      if (!userId || !increments || typeof increments !== 'object') {
        return
      }

      const now = atDate instanceof Date ? atDate : instantToDate(nowInstant())
      const dateKey = toUtcDateKey(now)

      const incDoc = {}
      let totalActions = 0
      const counterKeys = [
        'notesCreated',
        'notesUpdated',
        'postMortemsCreated',
        'flashcardsCreated',
        'flashcardsReviewed',
      ]

      for (const key of counterKeys) {
        const val = Number(increments[key]) || 0
        if (val > 0) {
          incDoc[key] = val
          if (key !== 'postMortemsCreated') {
            totalActions += val
          }
        }
      }

      if (totalActions === 0 && Object.keys(incDoc).length === 0) {
        return
      }

      incDoc.totalActions = totalActions

      await dailyActivity.updateOne(
        { userId, date: dateKey },
        {
          $inc: incDoc,
          $set: { updatedAt: now },
          $setOnInsert: {
            userId,
            date: dateKey,
            createdAt: now,
          },
        },
        { upsert: true },
      )
    }

    async function getDashboardSummary(userId) {
      const now = instantToDate(nowInstant())
      const dateKeys84 = buildUtcDateRangeEndingAt(now, HEATMAP_DAYS_COUNT)
      const startDateKey = dateKeys84[0]
      const endDateKey = dateKeys84[dateKeys84.length - 1]

      const [dueFlashcardsCount, inboxNoteCount, activeContainerDocs, activityDocs] =
        await Promise.all([
          flashcards.countDocuments({
            userId,
            nextReviewAt: { $lte: now },
          }),
          notes.countDocuments({
            userId,
            notebookId: null,
            folderId: null,
          }),
          notebooks
            .find({ userId, status: { $ne: 'archived' } }, { projection: { _id: 0, userId: 0 } })
            .sort({ modifiedAt: -1 })
            .toArray(),
          dailyActivity
            .find(
              { userId, date: { $gte: startDateKey, $lte: endDateKey } },
              { projection: { _id: 0, userId: 0 } },
            )
            .toArray(),
        ])

      const allNotesById = new Map()
      const notesByNotebook = new Map()

      if (activeContainerDocs.length > 0) {
        const activeContainerIds = activeContainerDocs.map((nb) => nb.id)
        const activeContainerNotes = await notes
          .find(
            { userId, notebookId: { $in: activeContainerIds } },
            {
              projection: {
                _id: 0,
                id: 1,
                notebookId: 1,
                readiness: 1,
                noteType: 1,
                links: 1,
              },
            },
          )
          .toArray()

        for (const note of activeContainerNotes) {
          allNotesById.set(note.id, note)
          const nbId = note.notebookId
          if (!notesByNotebook.has(nbId)) {
            notesByNotebook.set(nbId, [])
          }
          notesByNotebook.get(nbId).push(note)
        }

        const externalTargetIds = new Set()
        for (const note of activeContainerNotes) {
          if (Array.isArray(note.links)) {
            for (let j = 0; j < note.links.length; j += 1) {
              const targetId = note.links[j]?.targetId
              if (targetId && !allNotesById.has(targetId)) {
                externalTargetIds.add(targetId)
              }
            }
          }
        }

        if (externalTargetIds.size > 0) {
          const externalTargetNotes = await notes
            .find(
              { userId, id: { $in: Array.from(externalTargetIds) } },
              {
                projection: {
                  _id: 0,
                  id: 1,
                  notebookId: 1,
                  readiness: 1,
                  noteType: 1,
                },
              },
            )
            .toArray()

          for (const extNote of externalTargetNotes) {
            allNotesById.set(extNote.id, extNote)
          }
        }
      }

      const activeCampaigns = []
      const activeNotebooks = []

      for (const rawNb of activeContainerDocs) {
        const directNotes = notesByNotebook.get(rawNb.id) || []
        const directIds = new Set()
        for (let i = 0; i < directNotes.length; i += 1) {
          directIds.add(directNotes[i].id)
        }
        const externalNotes = []
        const seenExternal = new Set()

        for (let i = 0; i < directNotes.length; i += 1) {
          const note = directNotes[i]
          if (Array.isArray(note.links)) {
            for (let j = 0; j < note.links.length; j += 1) {
              const targetId = note.links[j]?.targetId
              if (
                targetId &&
                !directIds.has(targetId) &&
                !seenExternal.has(targetId) &&
                allNotesById.has(targetId)
              ) {
                seenExternal.add(targetId)
                externalNotes.push(allNotesById.get(targetId))
              }
            }
          }
        }

        const readiness = computeReadinessSummary(directNotes, externalNotes)
        const mode = rawNb.mode === 'campaign' ? 'campaign' : 'notebook'
        const rawTargetDate = rawNb.targetDate ?? null
        const targetDate =
          rawTargetDate instanceof Date ? rawTargetDate.toISOString() : rawTargetDate

        if (mode === 'campaign') {
          activeCampaigns.push({
            id: rawNb.id,
            name: rawNb.name,
            description: rawNb.description ?? '',
            mode: 'campaign',
            status: 'active',
            targetDate,
            createdAt: rawNb.createdAt,
            modifiedAt: rawNb.modifiedAt,
            totalNoteCount: directNotes.length,
            readiness,
          })
        } else {
          activeNotebooks.push({
            id: rawNb.id,
            name: rawNb.name,
            description: rawNb.description ?? '',
            mode: 'notebook',
            status: 'active',
            targetDate,
            createdAt: rawNb.createdAt,
            modifiedAt: rawNb.modifiedAt,
            totalNoteCount: directNotes.length,
            readiness,
          })
        }
      }

      const activityByDate = new Map()
      for (const doc of activityDocs) {
        activityByDate.set(doc.date, doc)
      }

      const heatmap12Weeks = new Array(HEATMAP_DAYS_COUNT)
      for (let i = 0; i < HEATMAP_DAYS_COUNT; i += 1) {
        const date = dateKeys84[i]
        const doc = activityByDate.get(date)
        heatmap12Weeks[i] = {
          date,
          totalActions: Number(doc?.totalActions) || 0,
          notesCreated: Number(doc?.notesCreated) || 0,
          notesUpdated: Number(doc?.notesUpdated) || 0,
          postMortemsCreated: Number(doc?.postMortemsCreated) || 0,
          flashcardsCreated: Number(doc?.flashcardsCreated) || 0,
          flashcardsReviewed: Number(doc?.flashcardsReviewed) || 0,
        }
      }

      const velocityDays = new Array(VELOCITY_DAYS_COUNT)
      let totalActions14 = 0
      let notesCreated14 = 0
      let notesUpdated14 = 0
      let flashcardsReviewed14 = 0

      const startVelocityIdx = HEATMAP_DAYS_COUNT - VELOCITY_DAYS_COUNT
      for (let i = 0; i < VELOCITY_DAYS_COUNT; i += 1) {
        const dayEntry = heatmap12Weeks[startVelocityIdx + i]
        velocityDays[i] = {
          date: dayEntry.date,
          totalActions: dayEntry.totalActions,
          notesCreated: dayEntry.notesCreated,
          notesUpdated: dayEntry.notesUpdated,
          flashcardsReviewed: dayEntry.flashcardsReviewed,
        }
        totalActions14 += dayEntry.totalActions
        notesCreated14 += dayEntry.notesCreated
        notesUpdated14 += dayEntry.notesUpdated
        flashcardsReviewed14 += dayEntry.flashcardsReviewed
      }

      return {
        inboxNoteCount,
        dueFlashcardsCount,
        activeCampaigns,
        activeNotebooks,
        heatmap12Weeks,
        velocity14Days: {
          days: velocityDays,
          totals: {
            totalActions: totalActions14,
            notesCreated: notesCreated14,
            notesUpdated: notesUpdated14,
            flashcardsReviewed: flashcardsReviewed14,
          },
        },
      }
    }

    fastify.decorate('recordDailyActivity', recordDailyActivity)
    fastify.decorate('dashboardDataSource', {
      getDashboardSummary,
      recordDailyActivity,
    })

    fastify.log.info('Successfully registered daily-activity-store plugin')
  },
  {
    dependencies: ['db-plugin'],
    name: 'daily-activity-store',
    decorators: {
      fastify: ['mongo'],
    },
  },
)
