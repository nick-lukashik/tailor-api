import { Injectable } from '@nestjs/common'
import { sql } from 'drizzle-orm'
import type { Tx } from '../db/types.js'

/** A live (queued or active) job of a pool, by its `singletonKey`. */
export type LiveJob = {
    queue: string
    queued: boolean
}

/**
 * The load of a model pool's queues, read from pg-boss's own table in the
 * caller's transaction. pg-boss's queue stats are refreshed by its monitor,
 * too stale to balance a burst on.
 */
@Injectable()
export class ModelPoolRepository {
    /** Live jobs per queue. */
    async load(tx: Tx, queues: string[]): Promise<Map<string, number>> {
        const counts = await tx.execute<{
            name: string
            count: number
        }>(sql`
            select name, count(*)::int as count from pgboss.job
            where name = any(${sql.param(queues)}::text[]) and state < 'completed'
            group by name
        `)
        return new Map(
            counts.rows.map(row => [
                row.name,
                row.count,
            ]),
        )
    }

    /** The queue of each key that has a live job (a queued job before an active one). */
    async live(tx: Tx, queues: string[], keys: string[]): Promise<Map<string, LiveJob>> {
        if (keys.length === 0) return new Map()
        const rows = await tx.execute<{
            key: string
            name: string
            queued: boolean
        }>(sql`
            select distinct on (singleton_key) singleton_key as key, name, state < 'active' as queued
            from pgboss.job
            where name = any(${sql.param(queues)}::text[])
              and singleton_key = any(${sql.param(keys)}::text[])
              and state < 'completed'
            order by singleton_key, state
        `)
        return new Map(
            rows.rows.map(row => [
                row.key,
                {
                    queue: row.name,
                    queued: row.queued,
                },
            ]),
        )
    }
}
