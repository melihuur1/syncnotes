import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  COLLAB_TICKET_AUDIENCE,
  COLLAB_TICKET_ISSUER,
  type CollabTicketClaims,
  type CollabTicketDto,
  type NoteRole,
} from '@syncnotes/shared';
import { randomUUID } from 'node:crypto';
import { APP_CONFIG, AppConfig } from '../config/env';

/**
 * Issues the short-lived, single-document ticket used for the WebSocket handshake.
 *
 * Why not send the access-token cookie to the collaboration server?
 * - the access token stays HttpOnly and never reaches JavaScript
 * - a ticket is bound to one note (`nid`) and a distinct audience/secret, so a leaked ticket
 *   cannot be used against the REST API or for another document
 * - the role is *not* trusted from the ticket: the collaboration server re-reads it from Postgres
 */
@Injectable()
export class CollabTicketService {
  constructor(
    private readonly jwt: JwtService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async issue(
    user: { id: string; name: string },
    noteId: string,
    role: NoteRole,
  ): Promise<CollabTicketDto> {
    const claims: CollabTicketClaims = { sub: user.id, nid: noteId, name: user.name };
    const token = await this.jwt.signAsync(claims, {
      secret: this.config.COLLAB_TICKET_SECRET,
      expiresIn: this.config.COLLAB_TICKET_TTL_SECONDS,
      audience: COLLAB_TICKET_AUDIENCE,
      issuer: COLLAB_TICKET_ISSUER,
      algorithm: 'HS256',
      jwtid: randomUUID(),
    });
    return { token, role, expiresIn: this.config.COLLAB_TICKET_TTL_SECONDS };
  }
}
