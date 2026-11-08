import { z } from 'zod'

export const meSchema = z
    .object({
        /** `sub` of the access token: the id to put on TAILOR_USERS. */
        userId: z.uuid(),
        invited: z.boolean(),
    })
    .meta({
        id: 'Me',
    })
export type Me = z.infer<typeof meSchema>
