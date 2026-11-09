import { Controller, Get, Header, Param, Res, StreamableFile } from '@nestjs/common'
import { ApiExcludeController } from '@nestjs/swagger'
import type { Response } from 'express'
import { CvService } from './cv.service.js'

/**
 * The only routes reachable from the internet: the ingress rewrites
 * `cv.<domain>/<path>` to `/api/v1/cv/<path>`, and nothing else of the API is
 * routed there. A CV link goes to employers, so it is never indexed or cached.
 *
 * The canonical link is `<application id>/<file name>`. The id alone, or a
 * wrong name, redirects (302: the name follows the role, which may change) with a relative Location, so the redirect is
 * right both on `cv.<domain>` and inside the cluster.
 */
@ApiExcludeController()
@Controller('cv')
export class CvController {
    constructor(private readonly cv: CvService) {}

    @Get(':id')
    async byId(@Param('id') id: string, @Res() res: Response) {
        const file = await this.cv.get(id)
        res.set('cache-control', 'no-store').redirect(302, `${encodeURIComponent(id)}/${file.fileName}`)
    }

    @Get(':id/:fileName')
    @Header('cache-control', 'private, no-store')
    @Header('x-robots-tag', 'noindex, nofollow')
    async file(
        @Param('id') id: string,
        @Param('fileName') fileName: string,
        @Res({
            passthrough: true,
        })
        res: Response,
    ) {
        const file = await this.cv.get(id)
        if (fileName !== file.fileName) {
            res.redirect(302, file.fileName)
            return
        }
        const content = await file.open()
        return new StreamableFile(content.body, {
            type: 'application/pdf',
            disposition: `inline; filename="${file.fileName}"`,
            length: content.length,
        })
    }
}
