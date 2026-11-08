import { z } from 'zod'

export const meSchema = z
    .object({
        /** `sub` of the access token. */
        userId: z.uuid(),
        /** Whether the token carries the `tailor` role. */
        allowed: z.boolean(),
    })
    .meta({
        id: 'Me',
    })
export type Me = z.infer<typeof meSchema>
