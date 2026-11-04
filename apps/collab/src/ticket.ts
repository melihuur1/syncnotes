import {
  COLLAB_TICKET_AUDIENCE,
  COLLAB_TICKET_ISSUER,
  type CollabTicketClaims,
} from '@syncnotes/shared';
import jwt from 'jsonwebtoken';

export class TicketError extends Error {}

/**
 * Verifies a collaboration ticket issued by the API.
 * The ticket only proves *identity* and *intent* (which note); authorisation is re-checked
 * against Postgres by the caller.
 */
export function verifyTicket(
  token: string,
  secret: string,
  documentName: string,
): CollabTicketClaims {
  if (!token) throw new TicketError('missing ticket');
  let claims: jwt.JwtPayload & Partial<CollabTicketClaims>;
  try {
    claims = jwt.verify(token, secret, {
      algorithms: ['HS256'],
      audience: COLLAB_TICKET_AUDIENCE,
      issuer: COLLAB_TICKET_ISSUER,
    }) as jwt.JwtPayload & Partial<CollabTicketClaims>;
  } catch (err) {
    throw new TicketError(`invalid ticket: ${(err as Error).message}`);
  }
  if (typeof claims.sub !== 'string' || typeof claims.nid !== 'string') {
    throw new TicketError('malformed ticket');
  }
  if (claims.nid !== documentName) throw new TicketError('ticket issued for another document');
  return {
    sub: claims.sub,
    nid: claims.nid,
    name: typeof claims.name === 'string' ? claims.name : 'Anonymous',
  };
}
