const { load } = require('./approvalFixture.cjs');
module.exports = function signupFixture(baseExecute) {
  const pending = new Map(); const limits = new Map(); const messages = [];
  let deliveryFails = false;
  const execute = async (sql, args = []) => {
    const q = sql.replace(/\s+/g, ' ').trim();
    if (q.startsWith('DELETE FROM signup_limits')) return [{}];
    if (q.startsWith('INSERT INTO signup_limits')) { limits.set(args[0], (limits.get(args[0]) || 0) + 1); return [{}]; }
    if (q.startsWith('SELECT attempts FROM signup_limits')) return [[{ attempts: limits.get(args[0]) }]];
    if (q.startsWith('INSERT INTO pending_signups')) {
      pending.set(args[0], { id: args[0], email: args[1], password_hash: args[2], code_hash: args[3], age: 0, expired: 0, attempts: 0, sends: 1 }); return [{}];
    }
    if (q.includes('FROM pending_signups WHERE id =') && q.startsWith('SELECT')) return [[pending.get(args[0])].filter(Boolean)];
    if (q.startsWith('DELETE FROM pending_signups WHERE id')) { pending.delete(args[0]); return [{}]; }
    if (q.startsWith('DELETE FROM pending_signups')) return [{}];
    if (q.startsWith('UPDATE pending_signups SET attempts')) { pending.get(args[0]).attempts++; return [{}]; }
    if (q.startsWith('UPDATE pending_signups SET code_hash')) { Object.assign(pending.get(args[1]), { code_hash: args[0], age: 0, expired: 0, sends: pending.get(args[1]).sends + 1 }); return [{}]; }
    return baseExecute(sql, args);
  };
  const pool = { execute, getConnection: async () => {
    let snapshot;
    return { execute, beginTransaction: async () => { snapshot = structuredClone(pending); }, commit: async () => {},
      rollback: async () => { pending.clear(); for (const [k,v] of snapshot) pending.set(k,v); }, release() {} };
  } };
  const mail = { configured: () => true, send: async (to, subject, text) => {
    if (deliveryFails) throw new Error('delivery failed');
    messages.push({ to, code: text.match(/\b\d{6}\b/)[0] });
  } };
  return { router: load('routes/signup.js', { '../public/scripts/db': pool, '../services/profileMail': mail }), pending, messages,
    failDelivery: value => { deliveryFails = value; } };
};
