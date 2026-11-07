import { Controller, Get, Header, Param, StreamableFile } from '@nestjs/common'
import { ApiExcludeController } from '@nestjs/swagger'
import { CvService } from './cv.service.js'

/**
 * The only routes reachable from the internet: `cv.<domain>/<code>` is
 * rewritten to `/api/v1/cv/<code>` by the ingress, and nothing else of the
 * API is routed there. A CV link goes to employers, so it is never indexed or cached.
 */
@ApiExcludeController()
@Controller('cv')
export class CvController {
    constructor(private readonly cv: CvService) {}

    @Get(':code')
    @Header('cache-control', 'private, no-store')
    @Header('x-robots-tag', 'noindex, nofollow')
    get(@Param('code') code: string) {
        const file = this.cv.get(code)
        return new StreamableFile(file.content, {
            type: 'application/pdf',
            disposition: `inline; filename="${file.fileName}"`,
            length: file.content.length,
        })
    }
}
