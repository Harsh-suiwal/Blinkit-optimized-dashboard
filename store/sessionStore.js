// express-session store on top of kv_store, so logins survive a server restart (Render sleeps and
// redeploys). One kv key per session: `session:<sid>` = { sess, expires (ms) }. Reads come from kv's
// in-memory copy, so a request never waits for the database; only login and logout write.
const session = require('express-session');
const kv = require('./kv');

const PREFIX = 'session:';
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

function expiryOf(sess) {
  const at = sess && sess.cookie && sess.cookie.expires ? new Date(sess.cookie.expires).getTime() : NaN;
  return Number.isFinite(at) ? at : Date.now() + DEFAULT_TTL_MS;
}

class KvSessionStore extends session.Store {
  get(sid, callback) {
    let row;
    try {
      row = kv.peek(PREFIX + sid, null);
    } catch (error) {
      return callback(error);
    }
    if (!row) return callback(null, null);
    if (row.expires <= Date.now()) {
      kv.delete(PREFIX + sid).catch(() => {});
      return callback(null, null);
    }
    // A private copy: express-session edits the object it is given.
    return callback(null, JSON.parse(JSON.stringify(row.sess)));
  }

  set(sid, sess, callback) {
    kv.set(PREFIX + sid, { sess, expires: expiryOf(sess) }).then(
      () => { this.prune(); callback(null); },
      callback,
    );
  }

  destroy(sid, callback) {
    kv.delete(PREFIX + sid).then(() => callback(null), callback);
  }

  /** Removes expired sessions. Runs after each save; there are only a handful of sessions. */
  prune() {
    for (const key of kv.keys()) {
      if (!key.startsWith(PREFIX)) continue;
      const row = kv.peek(key, null);
      if (!row || row.expires <= Date.now()) kv.delete(key).catch(() => {});
    }
  }
}

module.exports = KvSessionStore;
