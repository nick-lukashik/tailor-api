import { Module } from '@nestjs/common'
import { LlmGatewayClient } from './llm-gateway.client.js'

/** The client of the platform LLM gateway, for the modules that call a model from their jobs. */
@Module({
    providers: [
        LlmGatewayClient,
    ],
    exports: [
        LlmGatewayClient,
    ],
})
export class LlmModule {}
