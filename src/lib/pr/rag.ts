import { desc, inArray } from 'drizzle-orm'

import { getActivitiesDb } from '@/lib/db/activities-client'
import { knowledgeChunks, knowledgeDocuments, ragRetrievalLogs } from '@/lib/db/activities-schema'
import { generateId } from '@/lib/utils'

export interface KnowledgeContext {
  id: string
  documentId: string
  content: string
  metadata: Record<string, unknown> | null
  source: string | null
  score: number
}

function parseJson(value: string | null): Record<string, unknown> | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

function tokenize(text: string) {
  return Array.from(new Set(text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(token => token.length >= 2)))
}

function scoreChunk(queryTokens: string[], content: string) {
  const normalized = content.toLowerCase()
  return queryTokens.reduce((score, token) => score + (normalized.includes(token) ? 1 : 0), 0)
}

export async function ingestKnowledgeDocument(input: {
  title: string
  source?: string | null
  content: string
  metadata?: Record<string, unknown> | null
}) {
  const db = await getActivitiesDb()
  const documentId = generateId('kdoc')
  const chunks = input.content
    .split(/\n{2,}/)
    .map(chunk => chunk.trim())
    .filter(Boolean)
    .flatMap(chunk => {
      if (chunk.length <= 1400) return [chunk]
      const parts: string[] = []
      for (let index = 0; index < chunk.length; index += 1200) {
        parts.push(chunk.slice(index, index + 1200))
      }
      return parts
    })

  await db.insert(knowledgeDocuments).values({
    id: documentId,
    title: input.title,
    source: input.source ?? null,
    metadataJson: input.metadata ? JSON.stringify(input.metadata) : null,
  })

  if (chunks.length > 0) {
    await db.insert(knowledgeChunks).values(
      chunks.map((chunk, index) => ({
        id: generateId('kchunk'),
        documentId,
        chunkIndex: index,
        content: chunk,
        metadataJson: input.metadata ? JSON.stringify(input.metadata) : null,
      })),
    )
  }

  return { documentId, chunks: chunks.length }
}

export async function retrieveKnowledge(query: string, limit = 4): Promise<KnowledgeContext[]> {
  const db = await getActivitiesDb()
  const queryTokens = tokenize(query)
  if (queryTokens.length === 0) return []

  const chunkRows = await db
    .select()
    .from(knowledgeChunks)
    .orderBy(desc(knowledgeChunks.createdAt))
    .limit(200)
  const documentIds = Array.from(new Set(chunkRows.map(row => row.documentId)))
  const documentRows = documentIds.length
    ? await db.select().from(knowledgeDocuments).where(inArray(knowledgeDocuments.id, documentIds))
    : []
  const documents = new Map(documentRows.map(row => [row.id, row]))

  const scored = chunkRows
    .map(row => ({
      id: row.id,
      documentId: row.documentId,
      content: row.content,
      metadata: parseJson(row.metadataJson),
      source: documents.get(row.documentId)?.source ?? null,
      score: scoreChunk(queryTokens, row.content),
    }))
    .filter(row => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)

  try {
    await db.insert(ragRetrievalLogs).values({
      id: generateId('raglog'),
      query,
      queryPlanJson: JSON.stringify({ mode: 'lexical', queryTokens, limit }),
      resultChunkIdsJson: JSON.stringify(scored.map(row => row.id)),
      scoresJson: JSON.stringify(scored.map(row => ({ id: row.id, score: row.score }))),
      selectedChunkIdsJson: JSON.stringify(scored.map(row => row.id)),
    })
  } catch (error) {
    console.warn('[PR] failed to write rag retrieval log:', (error as Error).message)
  }

  return scored
}
