// Storage: MongoDB when MONGODB_URI is set, otherwise an in-memory store (handy for local dev).
import crypto from 'node:crypto';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = () => Array.from(crypto.randomBytes(6), b => ALPHABET[b % 32]).join('');
const newKey = () => crypto.randomBytes(24).toString('hex');
const DAY = 86400e3;

export function memoryStore() {
  const sessions = new Map(), anims = new Map();
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [k, s] of sessions) if (now - s.createdAt > 7 * DAY) sessions.delete(k);
    for (const [k, a] of anims) if (now - a.createdAt > 30 * DAY) anims.delete(k);
  }, 3600e3);
  sweep.unref();
  return {
    kind: 'memory',
    async createSession() {
      const s = { id: crypto.randomBytes(12).toString('hex'), code: newCode(), key: newKey(), claimed: false, queue: [], createdAt: Date.now() };
      sessions.set(s.id, s);
      return s;
    },
    async getSession(id) { return sessions.get(id) ?? null; },
    async claim(code) {
      const s = [...sessions.values()].find(x => x.code === code && !x.claimed);
      if (!s) return null;
      s.claimed = true;
      return s.key;
    },
    async enqueue(id, anim) {
      const s = sessions.get(id);
      if (!s?.claimed) return false;
      s.queue.push(anim);
      return true;
    },
    async poll(key) {
      const s = [...sessions.values()].find(x => x.key === key);
      if (!s) return { ok: false };
      return { ok: true, anim: s.queue.shift() ?? null };
    },
    async saveAnim(doc) { const id = crypto.randomBytes(12).toString('hex'); anims.set(id, { ...doc, createdAt: Date.now() }); return id; },
    async getAnim(id) { const a = anims.get(id); return a ? { ...a, id } : null; },
    async listAnims(sid, limit = 50) {
      return [...anims.entries()].filter(([, a]) => a.sid === sid).sort((a, b) => a[1].createdAt - b[1].createdAt).slice(-limit).map(([id, a]) => ({ ...a, id }));
    },
    async close() { clearInterval(sweep); },
  };
}

export async function mongoStore(uri, dbName = 'animator') {
  const { MongoClient, ObjectId } = await import('mongodb');
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);
  const sessions = db.collection('sessions'), animations = db.collection('animations');
  await Promise.all([
    sessions.createIndex({ createdAt: 1 }, { expireAfterSeconds: 7 * 86400 }),
    sessions.createIndex({ code: 1 }),
    sessions.createIndex({ key: 1 }),
    animations.createIndex({ createdAt: 1 }, { expireAfterSeconds: 30 * 86400 }),
    animations.createIndex({ sid: 1, createdAt: 1 }),
  ]);
  const oid = id => (ObjectId.isValid(id) ? new ObjectId(id) : null);
  const pub = a => (a ? { ...a, id: a._id.toString(), _id: undefined } : null);
  return {
    kind: 'mongo',
    async createSession() {
      const s = { _id: crypto.randomBytes(12).toString('hex'), code: newCode(), key: newKey(), claimed: false, queue: [], createdAt: new Date() };
      await sessions.insertOne(s);
      return { ...s, id: s._id };
    },
    async getSession(id) { const s = await sessions.findOne({ _id: String(id) }); return s && { ...s, id: s._id }; },
    async claim(code) {
      const s = await sessions.findOneAndUpdate({ code, claimed: false }, { $set: { claimed: true } }, { returnDocument: 'after' });
      return s?.key ?? null;
    },
    async enqueue(id, anim) { return (await sessions.updateOne({ _id: String(id), claimed: true }, { $push: { queue: anim } })).matchedCount > 0; },
    async poll(key) {
      const s = await sessions.findOneAndUpdate({ key: String(key) }, { $pop: { queue: -1 } }, { returnDocument: 'before' });
      return s ? { ok: true, anim: s.queue?.[0] ?? null } : { ok: false };
    },
    async saveAnim(doc) { return (await animations.insertOne({ ...doc, createdAt: new Date() })).insertedId.toString(); },
    async getAnim(id) { const o = oid(id); return o ? pub(await animations.findOne({ _id: o })) : null; },
    async listAnims(sid, limit = 50) { return (await animations.find({ sid }).sort({ createdAt: -1 }).limit(limit).toArray()).reverse().map(pub); },
    async close() { await client.close(); },
  };
}

export const openStore = () => (process.env.MONGODB_URI ? mongoStore(process.env.MONGODB_URI, process.env.MONGODB_DB || 'animator') : memoryStore());
