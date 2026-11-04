import { Injectable, OnModuleInit } from '@nestjs/common';
import * as argon2 from 'argon2';

/** Argon2id hashing (OWASP recommended parameters: m=19 MiB, t=2, p=1). */
@Injectable()
export class PasswordService implements OnModuleInit {
  private static readonly OPTIONS = {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  } as const;

  /** Hash used to keep login timing constant for unknown e-mails (prevents user enumeration). */
  private dummyHash = '';

  async onModuleInit(): Promise<void> {
    this.dummyHash = await this.hash('timing-equalisation-dummy-password');
  }

  hash(password: string): Promise<string> {
    return argon2.hash(password, PasswordService.OPTIONS);
  }

  async verify(hash: string, password: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, password);
    } catch {
      return false;
    }
  }

  /** Burn the same CPU time as a real verification, always returning false. */
  async verifyDummy(password: string): Promise<false> {
    if (this.dummyHash) await this.verify(this.dummyHash, password);
    return false;
  }
}
