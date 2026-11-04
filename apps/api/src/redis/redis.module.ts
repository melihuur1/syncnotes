import { Global, Module } from '@nestjs/common';
import { AccessEventsPublisher } from './access-events.publisher';

@Global()
@Module({
  providers: [AccessEventsPublisher],
  exports: [AccessEventsPublisher],
})
export class RedisModule {}
