/**
 * Block Parser — groups flat TranscriptEntry[] into logical TranscriptBlock[].
 *
 * A TranscriptBlock is the atomic unit of prompt projection: you never split
 * a block. Either the whole block goes into the prompt, or it gets compacted.
 *
 * Block types:
 *   - ToolInteractionBlock: assistant(tool_calls) + matching tool results
 *   - TextBlock: assistant text-only (no tool_calls)
 *   - UserBlock: user message
 *   - SystemBlock: system message
 */

import type {
  SystemBlock,
  TextBlock,
  ToolInteractionBlock,
  TranscriptBlock,
  TranscriptEntry,
  UserBlock,
} from './types'

/**
 * Parse a flat array of transcript entries into an ordered sequence of blocks.
 *
 * Walk forward through entries:
 *   - `role:system` → SystemBlock
 *   - `role:user` → UserBlock
 *   - `role:assistant` with `toolCalls` → ToolInteractionBlock
 *     (consumes subsequent `role:tool` entries matching the claimed ids)
 *   - `role:assistant` without `toolCalls` → TextBlock
 *   - `role:tool` without a preceding assistant → treated as orphan,
 *     wrapped in a TextBlock defensively (should not appear in valid sequences)
 */
export function parseTranscriptBlocks(entries: readonly TranscriptEntry[]): TranscriptBlock[] {
  const blocks: TranscriptBlock[] = []
  let i = 0

  while (i < entries.length) {
    const entry = entries[i]

    if (entry.role === 'system') {
      const block: SystemBlock = {
        kind: 'system',
        entry,
        entryIdRange: [entry.id, entry.id],
      }
      blocks.push(block)
      i++
      continue
    }

    if (entry.role === 'user') {
      const block: UserBlock = {
        kind: 'user',
        entry,
        entryIdRange: [entry.id, entry.id],
      }
      blocks.push(block)
      i++
      continue
    }

    if (entry.role === 'assistant') {
      if (entry.toolCalls && entry.toolCalls.length > 0) {
        // ToolInteractionBlock: assistant + all matching tool results
        const claimedIds = new Set<string>(entry.toolCalls.map(tc => tc.id))
        const toolResults: TranscriptEntry[] = []
        // Retry or replay can duplicate tool results. Keep the first occurrence of each tool_call_id because providers reject duplicate result messages.
        const seenResultIds = new Set<string>()
        let lastId = entry.id
        let j = i + 1

        // Consume contiguous tool messages that match claimed ids
        while (j < entries.length && entries[j].role === 'tool') {
          const toolEntry = entries[j]

          if (!toolEntry.toolCallId || !claimedIds.has(toolEntry.toolCallId)) {
            // Not claimed by this block — stop consuming; this entry belongs to
            // the next block (orphan handling or a separate assistant turn).
            break
          }

          if (seenResultIds.has(toolEntry.toolCallId)) {
            // Skip duplicate results without ending this block. Later results for other declared tool calls must remain attached instead of becoming orphaned.
            j++
            continue
          }

          seenResultIds.add(toolEntry.toolCallId)
          toolResults.push(toolEntry)
          lastId = toolEntry.id
          j++
        }

        const block: ToolInteractionBlock = {
          kind: 'tool_interaction',
          assistant: entry,
          toolResults,
          entryIdRange: [entry.id, lastId],
        }
        blocks.push(block)
        i = j
      }
      else {
        // TextBlock: plain assistant text
        const block: TextBlock = {
          kind: 'text',
          entry,
          entryIdRange: [entry.id, entry.id],
        }
        blocks.push(block)
        i++
      }
      continue
    }

    if (entry.role === 'tool') {
      // Orphan tool message — defensive wrapping.
      // NOTICE: This should not happen in valid sequences. If it does,
      // something upstream produced a broken tool result without a matching
      // assistant tool_call. We wrap it so it doesn't get silently lost.
      const block: TextBlock = {
        kind: 'text',
        entry,
        entryIdRange: [entry.id, entry.id],
      }
      blocks.push(block)
      i++
      continue
    }

    // Unknown role — skip
    i++
  }

  return blocks
}
