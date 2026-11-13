import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@bidstream/db';
import type { AuthConfig } from './config.js';
import {
  EmailAlreadyRegistered,
  InvalidCredentials,
  InvalidRefreshToken,
  WeakPassword,
} from './errors.js';
import { hashPassword, passwordProblems, verifyAgainstDummy, verifyPassword } from './password.js';
import {
  hashRefreshToken,
  newRefreshToken,
  signAccessToken,
  type Identity,
  type Role,
} from './tokens.js';

export type AuthDb = Pick<PrismaClient, 'appUser' | 'refreshToken' | '$transaction'>;

export interface TokenPair {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly tokenType: 'Bearer';
  /** Vida del token de acceso, en segundos. */
  readonly expiresIn: number;
}

export interface ClientInfo {
  readonly ip?: string | undefined;
  readonly userAgent?: string | undefined;
}

export interface CreatedUser {
  readonly id: string;
  readonly tenantId: string;
  readonly email: string;
  readonly role: Role;
}

export interface AuthServiceDeps {
  readonly db: AuthDb;
  readonly config: AuthConfig;
  readonly now?: () => Date;
}

/** Los correos se comparan en minúsculas y sin espacios. */
export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

/**
 * Autenticación propia (F1, ADR-0013): usuarios con Argon2id, JWT de acceso corto y refresh tokens
 * opacos de un solo uso con rotación y detección de reutilización, y bloqueo temporal por intentos.
 * No sabe de HTTP: la capa de rutas traduce sus errores.
 */
export class AuthService {
  private readonly now: () => Date;

  constructor(private readonly deps: AuthServiceDeps) {
    this.now = deps.now ?? ((): Date => new Date());
  }

  /** Crea un usuario. Lanza `WeakPassword` o `EmailAlreadyRegistered`. */
  async createUser(input: {
    tenantId: string;
    email: string;
    password: string;
    role: Role;
  }): Promise<CreatedUser> {
    const email = normalizeEmail(input.email);
    const problems = passwordProblems(input.password, email);
    if (problems.length > 0) throw new WeakPassword(problems);
    const id = randomUUID();
    try {
      await this.deps.db.appUser.create({
        data: {
          id,
          tenantId: input.tenantId,
          email,
          passwordHash: await hashPassword(input.password),
          role: input.role,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new EmailAlreadyRegistered();
      }
      throw error;
    }
    return { id, tenantId: input.tenantId, email, role: input.role };
  }

  /**
   * Inicia sesión. Cualquier fallo (usuario inexistente, contraseña incorrecta, cuenta bloqueada o
   * deshabilitada) es el mismo `InvalidCredentials` y cuesta lo mismo, para no revelar qué falló.
   */
  async login(
    input: { tenantId: string; email: string; password: string },
    client: ClientInfo = {},
  ): Promise<TokenPair> {
    const email = normalizeEmail(input.email);
    const user = await this.deps.db.appUser.findUnique({
      where: { tenantId_email: { tenantId: input.tenantId, email } },
    });
    const now = this.now();
    if (
      user === null ||
      user.status !== 'ACTIVE' ||
      (user.lockedUntil !== null && user.lockedUntil > now)
    ) {
      await verifyAgainstDummy(input.password);
      throw new InvalidCredentials();
    }
    if (!(await verifyPassword(user.passwordHash, input.password))) {
      await this.registerFailure(user.id);
      throw new InvalidCredentials();
    }
    if (user.failedAttempts > 0 || user.lockedUntil !== null) {
      await this.deps.db.appUser.update({
        where: { id: user.id },
        data: { failedAttempts: 0, lockedUntil: null },
      });
    }
    return this.issue(
      { userId: user.id, tenantId: user.tenantId, role: user.role },
      randomUUID(),
      client,
    );
  }

  private async registerFailure(userId: string): Promise<void> {
    const updated = await this.deps.db.appUser.update({
      where: { id: userId },
      data: { failedAttempts: { increment: 1 } },
    });
    if (updated.failedAttempts >= this.deps.config.maxFailedAttempts) {
      await this.deps.db.appUser.update({
        where: { id: userId },
        data: {
          failedAttempts: 0,
          lockedUntil: new Date(this.now().getTime() + this.deps.config.lockMinutes * 60_000),
        },
      });
    }
  }

  /**
   * Cambia un refresh token por un par nuevo (rotación). El token usado queda revocado; si se presenta
   * uno **ya usado o revocado** se revoca toda su familia (posible robo) y se rechaza.
   */
  async refresh(refreshToken: string, client: ClientInfo = {}): Promise<TokenPair> {
    const now = this.now();
    const stored = await this.deps.db.refreshToken.findUnique({
      where: { tokenHash: hashRefreshToken(refreshToken) },
      include: { user: true },
    });
    if (stored === null) throw new InvalidRefreshToken();
    if (stored.revokedAt !== null) {
      await this.revokeFamily(stored.familyId);
      throw new InvalidRefreshToken();
    }
    if (stored.expiresAt <= now || stored.user.status !== 'ACTIVE') {
      throw new InvalidRefreshToken();
    }
    const replacementId = randomUUID();
    // `updateMany` con `revokedAt: null` es atómico: de dos usos simultáneos solo uno gana.
    const claimed = await this.deps.db.refreshToken.updateMany({
      where: { id: stored.id, revokedAt: null },
      data: { revokedAt: now, replacedBy: replacementId },
    });
    if (claimed.count === 0) {
      await this.revokeFamily(stored.familyId);
      throw new InvalidRefreshToken();
    }
    return this.issue(
      { userId: stored.user.id, tenantId: stored.user.tenantId, role: stored.user.role },
      stored.familyId,
      client,
      replacementId,
    );
  }

  /** Cierra la sesión: revoca la familia del refresh token. Es idempotente y no revela si existía. */
  async logout(refreshToken: string): Promise<void> {
    const stored = await this.deps.db.refreshToken.findUnique({
      where: { tokenHash: hashRefreshToken(refreshToken) },
    });
    if (stored !== null) await this.revokeFamily(stored.familyId);
  }

  private async revokeFamily(familyId: string): Promise<void> {
    await this.deps.db.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: this.now() },
    });
  }

  /** Datos públicos del usuario autenticado. */
  async profile(identity: Identity): Promise<{ email: string } | null> {
    const user = await this.deps.db.appUser.findUnique({
      where: { id: identity.userId },
      select: { email: true, tenantId: true, status: true },
    });
    return user !== null && user.tenantId === identity.tenantId && user.status === 'ACTIVE'
      ? { email: user.email }
      : null;
  }

  private async issue(
    identity: Identity,
    familyId: string,
    client: ClientInfo,
    id: string = randomUUID(),
  ): Promise<TokenPair> {
    const { config } = this.deps;
    if (config.signer === null) throw new Error('este proceso no tiene clave para emitir tokens');
    const now = this.now();
    const refreshToken = newRefreshToken();
    await this.deps.db.refreshToken.create({
      data: {
        id,
        userId: identity.userId,
        familyId,
        tokenHash: hashRefreshToken(refreshToken),
        expiresAt: new Date(now.getTime() + config.refreshTtlSeconds * 1000),
        userAgent: client.userAgent?.slice(0, 256) ?? null,
        ip: client.ip ?? null,
      },
    });
    return {
      accessToken: await signAccessToken(config.signer, identity, config.accessTtlSeconds, now),
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: config.accessTtlSeconds,
    };
  }
}
