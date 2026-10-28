const cbs = [];
const cur = () => JSON.parse(localStorage.getItem('mockuser') || 'null');
const set = (u) => { localStorage.setItem('mockuser', JSON.stringify(u)); cbs.forEach((f) => f(u)); return { user: u }; };
export const getAuth = () => ({});
export const onAuthStateChanged = (a, f) => { cbs.push(f); setTimeout(() => f(cur()), 10); };
export const signInWithEmailAndPassword = async (a, e, p) => { if (p.length < 6) throw { code: 'auth/invalid-credential' }; return set({ uid: 'u_' + e, email: e }); };
export const createUserWithEmailAndPassword = signInWithEmailAndPassword;
export const signInWithPopup = async () => set({ uid: 'g1', email: 'g@gmail.com' });
export const signOut = async () => set(null);
export class GoogleAuthProvider {}
export const sendPasswordResetEmail = async () => {};
