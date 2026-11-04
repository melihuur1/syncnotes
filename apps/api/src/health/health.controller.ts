import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../common/decorators';
import { PrismaService } from '../prisma/prisma.service';
import { AccessEventsPublisher } from '../redis/access-events.publisher';

@Controller('health')
@SkipThrottle()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: AccessEventsPublisher,
  ) {}

  /**
   * Postgres is required (503 when down). Redis is reported but not required: the API keeps
   * serving requests without it (access events degrade to the collab server's TTL re-check).
   */
  @Public()
  @Get()
  async check(): Promise<{ status: 'ok'; db: 'up'; redis: 'up' | 'down' }> {
    const [db, redis] = await Promise.all([
      this.prisma.db.$queryRaw`SELECT 1`.then(
        () => true,
        () => false,
      ),
      this.redis.ping(),
    ]);
    if (!db) {
      throw new HttpException({ status: 'error', db: 'down' }, HttpStatus.SERVICE_UNAVAILABLE);
    }
    return { status: 'ok', db: 'up', redis: redis ? 'up' : 'down' };
  }
}
