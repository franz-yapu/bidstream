import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { createTestDatabase, type TestDatabase } from '@bidstream/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AuthService,
  EmailAlreadyRegistered,
  InvalidCredentials,
  InvalidRefreshToken,
  loadAuthConfig,
  verifyAccessToken,
  WeakPassword,
} from './index.js';

// F1: servicio de autenticación contra PostgreSQL real.
const keys = generateKeyPairSync('ed25519');
const config = loadAuthConfig({
  AUTH_JWT_PRIVATE_KEY: Buffer.from(
    keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  ).toString('base64'),
  AUTH_JWT_KEY_ID: 'k1',
});
const TENANT = '11111111-1111-4111-8111-111111111111';
const OTHER_TENANT = '33333333-3333-4333-8333-333333333333';
const PASSWORD = 'una-contraseña-larga-123';

let db: TestDatabase;
let clock = new Date('2026-11-14T12:00:00.000Z');
let auth: AuthService;

const email = (): string => `usuario-${randomUUID().slice(0, 8)}@ejemplo.com`;
const advance = (ms: number): void => {
  clock = new Date(clock.getTime() + ms);
};

beforeAll(async () => {
  db = await createTestDatabase();
  auth = new AuthService({ db: db.prisma, config, now: () => clock });
});

afterAll(async () => {
  await db.drop();
});

async function newUser(role: 'ADMIN' | 'SELLER' | 'BIDDER' = 'BIDDER') {
  const address = email();
  const user = await auth.createUser({
    tenantId: TENANT,
    email: address,
    password: PASSWORD,
    role,
  });
  return { ...user, address };
}

describe('registro', () => {
  it('crea el usuario con la contraseña en Argon2id y el correo normalizado', async () => {
    const created = await auth.createUser({
      tenantId: TENANT,
      email: '  Persona.Nueva@Ejemplo.COM ',
      password: PASSWORD,
      role: 'BIDDER',
    });
    expect(created.email).toBe('persona.nueva@ejemplo.com');
    const row = await db.prisma.appUser.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.passwordHash).toMatch(/^\$argon2id\$/);
    expect(row.passwordHash).not.toContain(PASSWORD);
    expect(row).toMatchObject({
      role: 'BIDDER',
      status: 'ACTIVE',
      failedAttempts: 0,
      lockedUntil: null,
    });
  });

  it('un correo repetido en el mismo tenant falla, y en otro tenant se permite', async () => {
    const { address } = await newUser();
    await expect(
      auth.createUser({
        tenantId: TENANT,
        email: address.toUpperCase(),
        password: PASSWORD,
        role: 'BIDDER',
      }),
    ).rejects.toThrow(EmailAlreadyRegistered);
    await expect(
      auth.createUser({
        tenantId: OTHER_TENANT,
        email: address,
        password: PASSWORD,
        role: 'BIDDER',
      }),
    ).resolves.toMatchObject({ tenantId: OTHER_TENANT });
  });

  it('rechaza una contraseña débil sin crear el usuario', async () => {
    const address = email();
    await expect(
      auth.createUser({ tenantId: TENANT, email: address, password: 'corta', role: 'BIDDER' }),
    ).rejects.toThrow(WeakPassword);
    expect(await db.prisma.appUser.count({ where: { email: address } })).toBe(0);
  });
});

describe('inicio de sesión', () => {
  it('devuelve un JWT con el usuario, el tenant y el rol, y un refresh token opaco', async () => {
    const { id, address } = await newUser('SELLER');
    const pair = await auth.login({ tenantId: TENANT, email: address, password: PASSWORD });
    expect(pair).toMatchObject({ tokenType: 'Bearer', expiresIn: 600 });
    expect(await verifyAccessToken(pair.accessToken, config.verifier, clock)).toEqual({
      userId: id,
      tenantId: TENANT,
      role: 'SELLER',
    });
    const stored = await db.prisma.refreshToken.findMany({ where: { userId: id } });
    expect(stored).toHaveLength(1);
    expect(stored[0]?.tokenHash).not.toContain(pair.refreshToken); // solo se guarda el hash
  });

  it('usuario inexistente, contraseña incorrecta y tenant equivocado dan el mismo error', async () => {
    const { address } = await newUser();
    const failures = await Promise.all(
      [
        { tenantId: TENANT, email: 'nadie@ejemplo.com', password: PASSWORD },
        { tenantId: TENANT, email: address, password: 'contraseña-incorrecta-1' },
        { tenantId: OTHER_TENANT, email: address, password: PASSWORD },
      ].map((input) =>
        auth.login(input).then(
          () => null,
          (error: unknown) => error,
        ),
      ),
    );
    for (const error of failures) {
      expect(error).toBeInstanceOf(InvalidCredentials);
      expect((error as Error).message).toBe('credenciales inválidas');
    }
  });

  it('un usuario deshabilitado no puede entrar', async () => {
    const { id, address } = await newUser();
    await db.prisma.appUser.update({ where: { id }, data: { status: 'DISABLED' } });
    await expect(
      auth.login({ tenantId: TENANT, email: address, password: PASSWORD }),
    ).rejects.toThrow(InvalidCredentials);
  });
});

describe('bloqueo por intentos', () => {
  it('5 fallos bloquean 15 minutos: ni la contraseña correcta entra hasta que caduca', async () => {
    const { id, address } = await newUser();
    const bad = { tenantId: TENANT, email: address, password: 'contraseña-incorrecta-1' };
    for (let i = 0; i < 5; i++) await expect(auth.login(bad)).rejects.toThrow(InvalidCredentials);
    const locked = await db.prisma.appUser.findUniqueOrThrow({ where: { id } });
    expect(locked.lockedUntil?.getTime()).toBe(clock.getTime() + 15 * 60_000);

    // bloqueada: la contraseña correcta tampoco entra, con el mismo error genérico
    await expect(
      auth.login({ tenantId: TENANT, email: address, password: PASSWORD }),
    ).rejects.toThrow(InvalidCredentials);
    advance(14 * 60_000);
    await expect(
      auth.login({ tenantId: TENANT, email: address, password: PASSWORD }),
    ).rejects.toThrow(InvalidCredentials);
    advance(2 * 60_000); // pasaron 16 minutos
    await expect(
      auth.login({ tenantId: TENANT, email: address, password: PASSWORD }),
    ).resolves.toMatchObject({
      tokenType: 'Bearer',
    });
    expect(await db.prisma.appUser.findUniqueOrThrow({ where: { id } })).toMatchObject({
      failedAttempts: 0,
      lockedUntil: null,
    });
  });

  it('un inicio correcto reinicia el contador de fallos', async () => {
    const { id, address } = await newUser();
    const bad = { tenantId: TENANT, email: address, password: 'contraseña-incorrecta-1' };
    for (let i = 0; i < 4; i++) await expect(auth.login(bad)).rejects.toThrow(InvalidCredentials);
    await auth.login({ tenantId: TENANT, email: address, password: PASSWORD });
    expect((await db.prisma.appUser.findUniqueOrThrow({ where: { id } })).failedAttempts).toBe(0);
    for (let i = 0; i < 4; i++) await expect(auth.login(bad)).rejects.toThrow(InvalidCredentials);
    await expect(
      auth.login({ tenantId: TENANT, email: address, password: PASSWORD }),
    ).resolves.toBeDefined();
  });

  it('el bloqueo de un usuario no afecta a otro', async () => {
    const victim = await newUser();
    const other = await newUser();
    for (let i = 0; i < 5; i++) {
      await auth
        .login({ tenantId: TENANT, email: victim.address, password: 'contraseña-incorrecta-1' })
        .catch(() => undefined);
    }
    await expect(
      auth.login({ tenantId: TENANT, email: other.address, password: PASSWORD }),
    ).resolves.toBeDefined();
  });
});

describe('refresh tokens', () => {
  it('rota: el nuevo funciona, el anterior queda revocado y los dos comparten familia', async () => {
    const { id, address } = await newUser();
    const first = await auth.login({ tenantId: TENANT, email: address, password: PASSWORD });
    const second = await auth.refresh(first.refreshToken);
    expect(second.refreshToken).not.toBe(first.refreshToken);
    const rows = await db.prisma.refreshToken.findMany({
      where: { userId: id },
      orderBy: { createdAt: 'asc' },
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]?.familyId).toBe(rows[1]?.familyId);
    expect(rows[0]?.revokedAt).not.toBeNull();
    expect(rows[0]?.replacedBy).toBe(rows[1]?.id);
    expect(rows[1]?.revokedAt).toBeNull();
  });

  it('reutilizar uno ya usado revoca toda la familia (también el token nuevo)', async () => {
    const { address } = await newUser();
    const first = await auth.login({ tenantId: TENANT, email: address, password: PASSWORD });
    const second = await auth.refresh(first.refreshToken);
    await expect(auth.refresh(first.refreshToken)).rejects.toThrow(InvalidRefreshToken); // robo
    await expect(auth.refresh(second.refreshToken)).rejects.toThrow(InvalidRefreshToken); // familia revocada
  });

  it('dos usos simultáneos del mismo token: solo uno gana y la familia se revoca', async () => {
    const { address } = await newUser();
    const first = await auth.login({ tenantId: TENANT, email: address, password: PASSWORD });
    const results = await Promise.allSettled([
      auth.refresh(first.refreshToken),
      auth.refresh(first.refreshToken),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
  });

  it('un token caducado, desconocido o de un usuario deshabilitado se rechaza', async () => {
    const { id, address } = await newUser();
    const pair = await auth.login({ tenantId: TENANT, email: address, password: PASSWORD });
    await expect(auth.refresh('token-que-no-existe')).rejects.toThrow(InvalidRefreshToken);
    await db.prisma.appUser.update({ where: { id }, data: { status: 'DISABLED' } });
    await expect(auth.refresh(pair.refreshToken)).rejects.toThrow(InvalidRefreshToken);
    await db.prisma.appUser.update({ where: { id }, data: { status: 'ACTIVE' } });
    advance(8 * 24 * 3_600_000); // más de 7 días
    await expect(auth.refresh(pair.refreshToken)).rejects.toThrow(InvalidRefreshToken);
  });

  it('logout revoca la familia; repetirlo o con un token falso no falla ni revela nada', async () => {
    const { address } = await newUser();
    const first = await auth.login({ tenantId: TENANT, email: address, password: PASSWORD });
    const second = await auth.refresh(first.refreshToken);
    await auth.logout(second.refreshToken);
    await auth.logout(second.refreshToken);
    await auth.logout('no-existe');
    await expect(auth.refresh(second.refreshToken)).rejects.toThrow(InvalidRefreshToken);
  });
});

describe('perfil', () => {
  it('devuelve el correo del usuario activo de su tenant y nada de otro', async () => {
    const { id, address } = await newUser();
    expect(await auth.profile({ userId: id, tenantId: TENANT, role: 'BIDDER' })).toEqual({
      email: address,
    });
    expect(await auth.profile({ userId: id, tenantId: OTHER_TENANT, role: 'BIDDER' })).toBeNull();
    expect(
      await auth.profile({ userId: randomUUID(), tenantId: TENANT, role: 'BIDDER' }),
    ).toBeNull();
  });
});
