'use strict'

const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const { seedUser } = require('../utils/setup-user')

describe('Campaigns, Leitner spaced-repetition drills, and Dashboard telemetry E2E workflow', () => {
  test('creates Campaign with starter folders, expands 1-hop external Readiness excluding Post-Mortems, executes Leitner Drills with bidirectional Readiness coupling, and updates Dashboard telemetry', async (t) => {
    const actor = await seedUser(t)
    const headers = { Authorization: `Bearer ${actor.accessToken}` }

    // 1. Create canonical Notebook + archived Notebook + Inbox reference Note
    const canonicalNbRes = await actor.app.inject({
      method: 'POST',
      url: '/notebooks',
      headers,
      payload: { name: 'Distributed Systems KB', mode: 'notebook' },
    })
    assert.equal(canonicalNbRes.statusCode, 201)
    const canonicalNb = canonicalNbRes.json().data

    const canonicalNoteRes = await actor.app.inject({
      method: 'POST',
      url: '/notes',
      headers,
      payload: {
        title: 'Raft Consensus',
        body: 'Leader election and log replication',
        notebookId: canonicalNb.id,
        readiness: 'to_review',
      },
    })
    assert.equal(canonicalNoteRes.statusCode, 201)
    const canonicalNote = canonicalNoteRes.json().data

    const archivedNbRes = await actor.app.inject({
      method: 'POST',
      url: '/notebooks',
      headers,
      payload: { name: 'Archived University KB', mode: 'notebook', status: 'archived' },
    })
    assert.equal(archivedNbRes.statusCode, 201)
    const archivedNoteRes = await actor.app.inject({
      method: 'POST',
      url: '/notes',
      headers,
      payload: {
        title: 'Virtual Memory',
        body: 'TLB & page tables',
        notebookId: archivedNbRes.json().data.id,
        readiness: 'mastered',
      },
    })
    assert.equal(archivedNoteRes.statusCode, 201)
    const archivedNote = archivedNoteRes.json().data

    // 2. Create Interview Campaign with starterTemplate='interview'
    const campaignRes = await actor.app.inject({
      method: 'POST',
      url: '/notebooks',
      headers,
      payload: {
        name: 'Cloudflare Staff Interview',
        mode: 'campaign',
        targetDate: '2026-12-15T09:00:00.000Z',
        starterTemplate: 'interview',
      },
    })
    assert.equal(campaignRes.statusCode, 201)
    const campaign = campaignRes.json().data

    const starterFoldersRes = await actor.app.inject({
      method: 'GET',
      url: `/notebooks/${campaign.id}/folders`,
      headers,
    })
    assert.equal(starterFoldersRes.statusCode, 200)
    const starterFolders = starterFoldersRes.json().data
    assert.equal(starterFolders.length, 4)
    const systemDesignFolder = starterFolders.find((f) => f.name.includes('System Design'))
    const debriefFolder = starterFolders.find((f) => f.name.includes('Post-Mortems'))

    // Create an exam Campaign with starterTemplate='exam', verify its 3 starter folders, and archive it
    const examCampRes = await actor.app.inject({
      method: 'POST',
      url: '/notebooks',
      headers,
      payload: {
        name: 'AWS Solutions Architect Exam',
        mode: 'campaign',
        starterTemplate: 'exam',
      },
    })
    assert.equal(examCampRes.statusCode, 201)
    const examCamp = examCampRes.json().data
    const examFoldersRes = await actor.app.inject({
      method: 'GET',
      url: `/notebooks/${examCamp.id}/folders`,
      headers,
    })
    assert.equal(examFoldersRes.statusCode, 200)
    assert.equal(examFoldersRes.json().data.length, 3)

    const archiveExamRes = await actor.app.inject({
      method: 'PUT',
      url: `/notebooks/${examCamp.id}`,
      headers,
      payload: { status: 'archived' },
    })
    assert.equal(archiveExamRes.statusCode, 200)

    // 3. Create Campaign Note linking 1-hop to canonicalNote & archivedNote + a Post-Mortem Note
    const campaignNoteRes = await actor.app.inject({
      method: 'POST',
      url: '/notes',
      headers,
      payload: {
        title: 'Global Rate Limiter Prep',
        body: `Study [[${canonicalNote.id}|Raft]] and [[${archivedNote.id}|VM]]`,
        notebookId: campaign.id,
        folderId: systemDesignFolder.id,
        readiness: 'to_review',
      },
    })
    assert.equal(campaignNoteRes.statusCode, 201)
    const campaignNote = campaignNoteRes.json().data

    const postMortemRes = await actor.app.inject({
      method: 'POST',
      url: '/notes',
      headers,
      payload: {
        title: 'Phone Screen Debrief',
        body: 'Review token bucket burst math',
        notebookId: campaign.id,
        folderId: debriefFolder.id,
        noteType: 'post_mortem',
      },
    })
    assert.equal(postMortemRes.statusCode, 201)

    // 4. Create Flashcards on both Campaign Note and 1-hop external Canonical Note
    const campCardRes = await actor.app.inject({
      method: 'POST',
      url: '/flashcards',
      headers,
      payload: {
        noteId: campaignNote.id,
        front: 'How do edge nodes synchronize rate-limit counters?',
        back: 'Gossip / sliding window counters',
      },
    })
    assert.equal(campCardRes.statusCode, 201)
    const campCard = campCardRes.json().data

    const extCardRes = await actor.app.inject({
      method: 'POST',
      url: '/flashcards',
      headers,
      payload: {
        noteId: canonicalNote.id,
        front: 'What prevents split-brain votes in Raft?',
        back: 'Quorum majority per term and randomized election timeouts',
      },
    })
    assert.equal(extCardRes.statusCode, 201)
    const extCard = extCardRes.json().data

    // 5. Scheduled drill on Campaign expands 1-hop external card
    const scheduledDrillRes = await actor.app.inject({
      method: 'GET',
      url: `/flashcards/drill?notebookId=${campaign.id}&mode=scheduled`,
      headers,
    })
    assert.equal(scheduledDrillRes.statusCode, 200)
    assert.equal(scheduledDrillRes.json().data.length, 2)

    // 6. Review campCard 3 times ('good' -> box 2 -> 3 -> 4) promoting campaignNote to 'mastered'
    for (let step = 0; step < 3; step += 1) {
      const revRes = await actor.app.inject({
        method: 'POST',
        url: `/flashcards/${campCard.id}/review`,
        headers,
        payload: { rating: 'good' },
      })
      assert.equal(revRes.statusCode, 200)
      if (step === 0) {
        assert.equal(revRes.json().data.noteReadiness, 'in_progress')
      }
      if (step === 2) {
        assert.equal(revRes.json().data.flashcard.box, 4)
        assert.equal(revRes.json().data.noteReadiness, 'mastered')
      }
    }

    // Review extCard once ('good' -> box 2) promoting canonicalNote to 'in_progress'
    const extRevRes = await actor.app.inject({
      method: 'POST',
      url: `/flashcards/${extCard.id}/review`,
      headers,
      payload: { rating: 'good' },
    })
    assert.equal(extRevRes.statusCode, 200)
    assert.equal(extRevRes.json().data.noteReadiness, 'in_progress')

    // Scheduled drill now has 0 due cards, while cram_all returns both (weakest box 2 first)
    const afterReviewScheduledRes = await actor.app.inject({
      method: 'GET',
      url: `/flashcards/drill?notebookId=${campaign.id}&mode=scheduled`,
      headers,
    })
    assert.equal(afterReviewScheduledRes.statusCode, 200)
    assert.equal(afterReviewScheduledRes.json().data.length, 0)

    const cramAllRes = await actor.app.inject({
      method: 'GET',
      url: `/flashcards/drill?notebookId=${campaign.id}&mode=cram_all&order=weakest_first`,
      headers,
    })
    assert.equal(cramAllRes.statusCode, 200)
    assert.deepEqual(
      cramAllRes.json().data.map((c) => c.id),
      [extCard.id, campCard.id],
    )

    // 7. Verify GET /dashboard/summary reflects Campaign Readiness (mastered + mastered + in_progress = 2.5/3 = 83%) and Daily Activity
    const summaryRes = await actor.app.inject({
      method: 'GET',
      url: '/dashboard/summary',
      headers,
    })
    assert.equal(summaryRes.statusCode, 200)
    const summary = summaryRes.json().data
    assert.equal(summary.dueFlashcardsCount, 0)
    assert.equal(summary.activeCampaigns.length, 1)
    assert.deepEqual(summary.activeCampaigns[0].readiness, {
      toReviewCount: 0,
      inProgressCount: 1,
      masteredCount: 2,
      totalCount: 3,
      scorePercent: 83,
      blocks: 8,
    })
    const todayHeatmap = summary.heatmap12Weeks[83]
    assert.equal(todayHeatmap.notesCreated, 4)
    assert.equal(todayHeatmap.postMortemsCreated, 1)
    assert.equal(todayHeatmap.flashcardsCreated, 2)
    assert.equal(todayHeatmap.flashcardsReviewed, 4)
    assert.equal(summary.velocity14Days.totals.flashcardsReviewed, 4)

    // 8. Lapsing campCard with 'again' demotes campaignNote from 'mastered' to 'in_progress'
    const lapseRes = await actor.app.inject({
      method: 'POST',
      url: `/flashcards/${campCard.id}/review`,
      headers,
      payload: { rating: 'again' },
    })
    assert.equal(lapseRes.statusCode, 200)
    assert.equal(lapseRes.json().data.flashcard.box, 1)
    assert.equal(lapseRes.json().data.noteReadiness, 'in_progress')
  })
})
