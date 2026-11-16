import { describe, expect, it, vi } from 'vitest';
import { createAuthedFetch } from './http';
import { REFRESH_KEY, SessionStore, type TokenPair } from './session';

const pair = (n: number): TokenPair => ({
  accessToken: `access-${String(n)}`,
  refreshToken: `refresh-${String(n)}-xxxxxxxxxxxxxxxxxxxx`,
  expiresIn: 600,
});

describe('SessionStore', () => {
  it('guarda el acceso solo en memoria y el refresco en sessionStorage, nunca en localStorage', () => {
    const store = new SessionStore(() => Promise.resolve(pair(2)));
    store.setTokens(pair(1));
    expect(store.accessToken).toBe('access-1');
    expect(window.sessionStorage.getItem(REFRESH_KEY)).toBe(pair(1).refreshToken);
    expect(window.localStorage.length).toBe(0);
    for (let i = 0; i < window.sessionStorage.length; i += 1) {
      const name = window.sessionStorage.key(i) ?? '';
      expect(window.sessionStorage.getItem(name)).not.toContain('access-1');
    }
  });

  it('varios refrescos simultáneos hacen UNA sola llamada (el refresco es de un solo uso)', async () => {
    const refreshFn = vi.fn(() => Promise.resolve(pair(2)));
    const store = new SessionStore(refreshFn);
    store.setTokens(pair(1));
    const results = await Promise.all([store.refresh(), store.refresh(), store.refresh()]);
    expect(results).toEqual([true, true, true]);
    expect(refreshFn).toHaveBeenCalledTimes(1);
    expect(refreshFn).toHaveBeenCalledWith(pair(1).refreshToken);
    expect(store.accessToken).toBe('access-2');
    expect(window.sessionStorage.getItem(REFRESH_KEY)).toBe(pair(2).refreshToken); // rotación
  });

  it('si el refresco falla, cierra la sesión', async () => {
    const store = new SessionStore(() => Promise.reject(new Error('revocado')));
    store.setTokens(pair(1));
    expect(await store.refresh()).toBe(false);
    expect(store.accessToken).toBeNull();
    expect(window.sessionStorage.getItem(REFRESH_KEY)).toBeNull();
  });

  it('sin token de refresco no hay nada que renovar', async () => {
    expect(await new SessionStore(() => Promise.resolve(pair(1))).refresh()).toBe(false);
  });
});

describe('createAuthedFetch', () => {
  it('ante varios 401 renueva una vez, reintenta con el token nuevo y devuelve las respuestas', async () => {
    const refreshFn = vi.fn(() => Promise.resolve(pair(2)));
    const store = new SessionStore(refreshFn);
    store.setTokens(pair(1));
    const seen: (string | null)[] = [];
    const authed = createAuthedFetch(store, (_url, init) => {
      const auth = new Headers(init?.headers).get('authorization');
      seen.push(auth);
      return Promise.resolve(
        new Response('{}', { status: auth === 'Bearer access-2' ? 200 : 401 }),
      );
    });
    const responses = await Promise.all([authed('/a'), authed('/b'), authed('/c')]);
    expect(responses.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(refreshFn).toHaveBeenCalledTimes(1);
    expect(seen.filter((a) => a === 'Bearer access-1')).toHaveLength(3);
  });

  it('si el refresco falla devuelve el 401 original y la sesión queda cerrada', async () => {
    const store = new SessionStore(() => Promise.reject(new Error('no')));
    store.setTokens(pair(1));
    const authed = createAuthedFetch(store, () =>
      Promise.resolve(new Response('{}', { status: 401 })),
    );
    expect((await authed('/a')).status).toBe(401);
    expect(store.accessToken).toBeNull();
  });
});
