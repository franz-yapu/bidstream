/** Credenciales incorrectas, usuario inexistente, deshabilitado o bloqueado: un único error genérico. */
export class InvalidCredentials extends Error {
  override readonly name = 'InvalidCredentials';
  constructor() {
    super('credenciales inválidas');
  }
}

/** Refresh token desconocido, caducado, ya usado o revocado. */
export class InvalidRefreshToken extends Error {
  override readonly name = 'InvalidRefreshToken';
  constructor() {
    super('refresh token inválido');
  }
}

/** Access token ausente, mal formado, caducado o con firma no válida. */
export class InvalidAccessToken extends Error {
  override readonly name = 'InvalidAccessToken';
  constructor() {
    super('access token inválido');
  }
}

export class EmailAlreadyRegistered extends Error {
  override readonly name = 'EmailAlreadyRegistered';
  constructor() {
    super('no se pudo completar el registro');
  }
}

/** El nombre público ya lo usa otro usuario del tenant (sin distinguir mayúsculas). */
export class DisplayNameTaken extends Error {
  override readonly name = 'DisplayNameTaken';
  constructor() {
    super('el nombre público ya está en uso');
  }
}

/** El usuario no existe en el tenant del administrador (o no se puede modificar). */
export class UserNotFound extends Error {
  override readonly name = 'UserNotFound';
  constructor() {
    super('el usuario no existe');
  }
}

/** El nombre público no cumple el formato. */
export class InvalidDisplayName extends Error {
  override readonly name = 'InvalidDisplayName';
  constructor(readonly problems: readonly string[]) {
    super(`nombre público no válido: ${problems.join('; ')}`);
  }
}

export class WeakPassword extends Error {
  override readonly name = 'WeakPassword';
  constructor(readonly problems: readonly string[]) {
    super(`contraseña débil: ${problems.join('; ')}`);
  }
}
