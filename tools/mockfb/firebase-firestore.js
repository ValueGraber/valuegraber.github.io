const K = (r) => 'mockfs:' + r.path;
export const getFirestore = () => ({});
export const doc = (f, c, id) => ({ path: c + '/' + id });
export const serverTimestamp = () => 'TS';
const snap = (r) => { const v = localStorage.getItem(K(r)); return { exists: () => v != null, data: () => JSON.parse(v), metadata: { hasPendingWrites: false } }; };
export const getDoc = async (r) => snap(r);
export const setDoc = async (r, d) => { localStorage.setItem(K(r), JSON.stringify(d)); window.__writes = (window.__writes || 0) + 1; };
export const onSnapshot = (r, cb) => { const h = (e) => { if (e.key === K(r)) cb(snap(r)); }; window.addEventListener('storage', h); setTimeout(() => cb(snap(r)), 5); return () => window.removeEventListener('storage', h); };
