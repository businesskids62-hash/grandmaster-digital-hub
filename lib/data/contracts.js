/**
 * Data-contract types shared by every storage backend. Documentation only:
 * this module has no runtime exports.
 *
 * @typedef {Object} UserRecord
 * @property {string} id
 * @property {string} email
 * @property {"admin"|"student"} role
 * @property {string|null} displayName
 * @property {string} passwordHash
 * @property {number} sessionVersion
 * @property {number} failedAttempts
 * @property {string|null} lockedUntil ISO-8601 UTC
 * @property {string|null} createdAt ISO-8601 UTC
 *
 * @typedef {Object} SessionIdentity
 * @property {string} id
 * @property {string} email
 * @property {"admin"|"student"} role
 * @property {number} sessionVersion
 *
 * @typedef {Object} UsersRepository
 * @property {(id: string) => Promise<UserRecord|null>} findById
 * @property {(id: string) => Promise<SessionIdentity|null>} findSessionIdentity
 * @property {(email: string) => Promise<UserRecord|null>} findAuthByEmail
 * @property {(email: string) => Promise<string|null>} findIdByEmail
 * @property {(input: { id: string, email: string, passwordHash: string, role?: string, displayName?: string|null, sessionVersion?: number, createdAt: string, updatedAt: string }) => Promise<UserRecord|null>} create
 * @property {(id: string, input: { failedAttempts: number, lockedUntil?: string|null, updatedAt: string }) => Promise<number>} recordFailedLogin
 * @property {(id: string) => Promise<number>} resetFailedLogins
 * @property {(id: string, passwordHash: string, updatedAt: string) => Promise<number>} updatePassword
 * @property {(id: string) => Promise<number>} deleteWithAuditDetach
 */

export {};
