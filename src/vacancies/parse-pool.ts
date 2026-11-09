import { poolQueueName } from '../llm/model-pool.js'

/** The queue of the release before the pool; drained, its jobs moved to the pool. Remove in the next release. */
export const LEGACY_PARSE_QUEUE = 'vacancy.parse'

/** One queue per parse model: `vacancy.parse.claude-sonnet-5-5`. */
export const parseQueueName = (model: string) => poolQueueName(LEGACY_PARSE_QUEUE, model)
