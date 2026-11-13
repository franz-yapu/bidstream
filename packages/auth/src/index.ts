export { loadAuthConfig, type AuthConfig } from './config.js';
export {
  EmailAlreadyRegistered,
  InvalidAccessToken,
  InvalidCredentials,
  InvalidRefreshToken,
  WeakPassword,
} from './errors.js';
export {
  hashPassword,
  passwordProblems,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  verifyAgainstDummy,
  verifyPassword,
} from './password.js';
export {
  AuthService,
  normalizeEmail,
  type AuthDb,
  type AuthServiceDeps,
  type ClientInfo,
  type CreatedUser,
  type TokenPair,
} from './service.js';
export {
  bearerToken,
  hashRefreshToken,
  newRefreshToken,
  ROLES,
  signAccessToken,
  verifyAccessToken,
  type Identity,
  type Role,
  type TokenSigner,
  type TokenVerifier,
} from './tokens.js';
