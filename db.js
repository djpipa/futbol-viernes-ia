// Capa de datos: Firebase (Firestore + Auth) si hay configuración, o localStorage si no.
window.DB = (() => {
  let mode = 'local', fs = null, auth = null;
  const cfg = window.FIREBASE_CONFIG || {};
  const key = col => 'futbol_' + col;

  const loadScript = src => new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = () => rej(new Error('No se pudo cargar ' + src));
    document.head.appendChild(s);
  });

  async function init() {
    if (cfg.apiKey) {
      const v = 'https://www.gstatic.com/firebasejs/10.14.1/';
      await loadScript(v + 'firebase-app-compat.js');
      await loadScript(v + 'firebase-auth-compat.js');
      await loadScript(v + 'firebase-firestore-compat.js');
      firebase.initializeApp(cfg);
      auth = firebase.auth();
      fs = firebase.firestore();
      mode = 'firebase';
    }
    return mode;
  }

  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const readLocal = col => JSON.parse(localStorage.getItem(key(col)) || '{}');
  const writeLocal = (col, data) => localStorage.setItem(key(col), JSON.stringify(data));

  async function list(col) {
    if (mode === 'firebase') {
      const snap = await fs.collection(col).get();
      return snap.docs.map(d => ({ ...d.data(), id: d.id }));
    }
    return Object.values(readLocal(col));
  }
  async function save(col, obj) {
    if (!obj.id) obj.id = newId();
    if (mode === 'firebase') await fs.collection(col).doc(obj.id).set(obj);
    else { const all = readLocal(col); all[obj.id] = obj; writeLocal(col, all); }
    return obj;
  }
  async function remove(col, id) {
    if (mode === 'firebase') await fs.collection(col).doc(id).delete();
    else { const all = readLocal(col); delete all[id]; writeLocal(col, all); }
  }

  return {
    init, list, save, remove,
    get mode() { return mode; },
    onAuth(cb) { mode === 'firebase' ? auth.onAuthStateChanged(cb) : cb({ email: 'modo local' }); },
    login: (email, pass) => auth.signInWithEmailAndPassword(email, pass),
    logout: () => auth.signOut()
  };
})();
