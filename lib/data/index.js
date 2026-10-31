import { createSqliteUsersRepository } from "./sqlite/users.js";

// One repository set per database handle. This module deliberately never
// imports lib/db/index.js: lib/db owns the handle, so importing it back would
// create an import cycle.
const cache = new WeakMap();

export function createRepositories(db) {
  if (!db || typeof db !== "object") {
    throw new TypeError("createRepositories(db) requires a database handle.");
  }
  return Object.freeze({ users: createSqliteUsersRepository(db) });
}

export function repositoriesFor(db) {
  if (!db || typeof db !== "object") {
    throw new TypeError("repositoriesFor(db) requires a database handle.");
  }
  let repositories = cache.get(db);
  if (!repositories) {
    repositories = createRepositories(db);
    cache.set(db, repositories);
  }
  return repositories;
}
