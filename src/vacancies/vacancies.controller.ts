import { Body, Controller, HttpCode, HttpStatus, Param, Post } from '@nestjs/common'
import { ApiAcceptedResponse, ApiHeader, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { AccessClaims } from '@nick-lukashik/auth'
import { Caller } from '@nick-lukashik/auth/nest'
import { TailorAccess } from '../access/tailor-role.guard.js'
import { ApiErrors } from '../common/openapi/openapi.js'
import {
    type VacancyIntake,
    vacancyIntakeResultSchema,
    vacancyIntakeSchema,
    vacancyParseQueuedSchema,
} from './vacancies.schemas.js'
import { VacanciesService } from './vacancies.service.js'

/** Pasted vacancies into the caller's pool. Thin: validation by schema on the parameter, the rest in VacanciesService. */
@ApiTags('vacancies')
@ApiHeader({
    name: 'x-request-id',
    required: false,
    description: 'Echoed back; generated when absent',
})
@Controller('vacancies')
@TailorAccess()
export class VacanciesController {
    constructor(private readonly vacancies: VacanciesService) {}

    @Post('intake')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({
        summary:
            "Links and texts of vacancies (1–200) into the caller's pool; each new text is parsed in the background",
    })
    @ApiOkResponse({
        standardSchema: vacancyIntakeResultSchema,
    })
    @ApiErrors(400, 401, 403, 413)
    intake(
        @Caller() caller: AccessClaims,
        @Body({
            schema: vacancyIntakeSchema,
        })
        body: VacancyIntake,
    ) {
        return this.vacancies.intake(caller.userId, body)
    }

    @Post(':id/parse')
    @HttpCode(HttpStatus.ACCEPTED)
    @ApiOperation({
        summary: "Parses a vacancy of the caller's pool again, in the background; `pending` until then",
    })
    @ApiAcceptedResponse({
        standardSchema: vacancyParseQueuedSchema,
    })
    @ApiErrors(401, 403, 404)
    reparse(@Caller() caller: AccessClaims, @Param('id') id: string) {
        return this.vacancies.reparse(caller.userId, id)
    }
}
