import { Module } from '@nestjs/common'
import { LlmGatewayClient } from './llm-gateway.client.js'
import { ModelPoolRepository } from './model-pool.repository.js'

/** The client of the platform LLM gateway and the queue load of a model pool, for the modules that call a model from their jobs. */
@Module({
    providers: [
        LlmGatewayClient,
        ModelPoolRepository,
    ],
    exports: [
        LlmGatewayClient,
        ModelPoolRepository,
    ],
})
export class LlmModule {}
