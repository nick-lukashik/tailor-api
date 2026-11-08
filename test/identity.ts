import { createServer, type Server } from 'node:http'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'

export const ISSUER = 'https://id.example.test'
export const AUDIENCE = 'nick-lukashik'

/**
 * A stand-in for id-api (as in wallet-api): its JWKS and access tokens signed
 * with the matching key, plus a key id-api never published, for forged tokens.
 */
export async function startIdentity() {
    const { publicKey, privateKey } = await generateKeyPair('ES256')
    const stranger = await generateKeyPair('ES256')
    const jwk = {
        ...(await exportJWK(publicKey)),
        kid: 'test-key',
        alg: 'ES256',
        use: 'sig',
    }
    let jwksRequests = 0
    const server: Server = createServer((request, response) => {
        response.setHeader('content-type', 'application/json')
        if (request.url === '/.well-known/jwks.json') {
            jwksRequests += 1
            response.end(
                JSON.stringify({
                    keys: [
                        jwk,
                    ],
                }),
            )
            return
        }
        response.statusCode = 404
        response.end('{}')
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('no address')
    const url = `http://127.0.0.1:${address.port}`

    type TokenOptions = {
        expiresIn?: string
        audience?: string
        issuer?: string
        signedBy?: 'id-api' | 'stranger'
    }
    /** An access token of `userId`, valid for five minutes unless told otherwise. */
    const token = (userId: string, options: TokenOptions = {}) =>
        new SignJWT({
            sid: crypto.randomUUID(),
            roles: [],
            av: 0,
        })
            .setProtectedHeader({
                alg: 'ES256',
                kid: 'test-key',
                typ: 'at+jwt',
            })
            .setSubject(userId)
            .setIssuer(options.issuer ?? ISSUER)
            .setAudience(options.audience ?? AUDIENCE)
            .setIssuedAt()
            .setExpirationTime(options.expiresIn ?? '5m')
            .sign(options.signedBy === 'stranger' ? stranger.privateKey : privateKey)

    return {
        url,
        jwksUrl: `${url}/.well-known/jwks.json`,
        token,
        /** `authorization` header value for `userId`. */
        bearer: async (userId: string, options?: TokenOptions) => `Bearer ${await token(userId, options)}`,
        jwksRequests: () => jwksRequests,
        close: () => new Promise<void>(resolve => server.close(() => resolve())),
    }
}
export type Identity = Awaited<ReturnType<typeof startIdentity>>
