// firebase.js - Firebase Auth + Firestore + Realtime Telemetry para BiciLog v0.0.6
// Config: reemplazar con las credenciales del proyecto Firebase

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyCs9BPWh6KGFdvrmAQYfhljNvGGg_aMDdo",
  authDomain: "bicilog-90afd.firebaseapp.com",
  projectId: "bicilog-90afd",
  storageBucket: "bicilog-90afd.firebasestorage.app",
  messagingSenderId: "568134072948",
  appId: "1:568134072948:web:11c8f2202a9af59d4e6f21"
};

const ADMIN_UPGRADE_CODE = "COACH2026";

let firebaseApp = null;
let firebaseAuth = null;
let firebaseDB = null;
let firestoreMod = null;
let initPromise = null;
let cachedFB = null;  // objeto completo con funciones de auth

async function initFirebase() {
  if (cachedFB) return cachedFB;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      // Timeout de 5s: si el CDN no carga, caer en modo local
      const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('CDN_TIMEOUT')), 5000));

      const appMod = await Promise.race([
        import('https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js'),
        timeout.catch(() => { throw new Error('CDN_TIMEOUT'); })
      ]);
      const { initializeApp } = appMod;

      const authMod = await Promise.race([
        import('https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js'),
        timeout.catch(() => { throw new Error('CDN_TIMEOUT'); })
      ]);
      const { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged, GoogleAuthProvider, signInWithRedirect, getRedirectResult } = authMod;

      const mod = await Promise.race([
        import('https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js'),
        timeout.catch(() => { throw new Error('CDN_TIMEOUT'); })
      ]);
      const { getFirestore, doc, setDoc, getDoc, updateDoc, collection, addDoc, query, where, onSnapshot, serverTimestamp, deleteDoc } = mod;
      firestoreMod = { doc, setDoc, getDoc, updateDoc, collection, addDoc, query, where, onSnapshot, serverTimestamp, deleteDoc };

      try {
        firebaseApp = initializeApp(FIREBASE_CONFIG);
      } catch (cfgErr) {
        console.warn('[Firebase] Configuración inválida. Modo Local activado:', cfgErr.message);
        initPromise = null;
        return null;
      }

      firebaseAuth = getAuth(firebaseApp);
      firebaseDB = getFirestore(firebaseApp);

      cachedFB = {
        app: firebaseApp, auth: firebaseAuth, db: firebaseDB, firestore: firestoreMod,
        signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged,
        GoogleAuthProvider, signInWithRedirect, getRedirectResult
      };
      return cachedFB;
    } catch (e) {
      console.warn('[Firebase] Init falló — Modo Local (offline):', e.message);
      initPromise = null;
      return null;
    }
  })();

  return initPromise;
}

// --- AUTENTICACIÓN ---

export const FBAuth = {
  currentUser: null,
  initialized: false,

  async init() {
    if (this.initialized) return;
    const fb = await initFirebase();
    if (!fb) return;
    fb.onAuthStateChanged(fb.auth, (user) => {
      this.currentUser = user;
      window.dispatchEvent(new CustomEvent('firebase-auth-change', { detail: { user } }));
    });
    // Capturar resultado de redirect (Google Sign-In en mobile/PWA)
    try {
      const result = await fb.getRedirectResult(fb.auth);
      if (result && result.user) {
        this.currentUser = result.user;
        window.dispatchEvent(new CustomEvent('firebase-auth-change', { detail: { user: result.user } }));
      }
    } catch (e) {
      console.warn('[Auth] Redirect result error:', e.message);
    }
    this.initialized = true;
  },

  async signInEmail(email, password) {
    const fb = await initFirebase();
    if (!fb) throw new Error('Firebase no disponible');
    const cred = await fb.signInWithEmailAndPassword(fb.auth, email, password);
    this.currentUser = cred.user;
    return cred.user;
  },

  async signUpEmail(email, password) {
    const fb = await initFirebase();
    if (!fb) throw new Error('Firebase no disponible');
    const cred = await fb.createUserWithEmailAndPassword(fb.auth, email, password);
    this.currentUser = cred.user;
    return cred.user;
  },

  async signOut() {
    const fb = await initFirebase();
    if (fb) await fb.signOut(fb.auth);
    this.currentUser = null;
  },

  async signInGoogle() {
    const fb = await initFirebase();
    if (!fb) throw new Error('Firebase no disponible');
    const provider = new fb.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    await fb.signInWithRedirect(fb.auth, provider);
  }
};

// --- PERFIL DE USUARIO (clubCode, role, telemetry toggle) ---

export async function saveUserProfile(profile) {
  const fb = await initFirebase();
  if (!fb || !FBAuth.currentUser) return false;
  try {
    const ref = fb.firestore.doc(fb.db, 'users', FBAuth.currentUser.uid);
    await fb.firestore.setDoc(ref, {
      uid: FBAuth.currentUser.uid,
      email: FBAuth.currentUser.email || '',
      role: profile.role || 'rider',
      clubCode: profile.clubCode || '',
      broadcastTelemetry: !!profile.broadcastTelemetry,
      displayName: profile.displayName || profile.name || FBAuth.currentUser.displayName || FBAuth.currentUser.email || '',
      updatedAt: Date.now()
    }, { merge: true });
    return true;
  } catch (e) {
    console.error('[Firebase] Error guardando perfil:', e);
    return false;
  }
}

export async function getUserProfile() {
  const fb = await initFirebase();
  if (!fb || !FBAuth.currentUser) return null;
  try {
    const ref = fb.firestore.doc(fb.db, 'users', FBAuth.currentUser.uid);
    const snap = await fb.firestore.getDoc(ref);
    return snap.exists() ? snap.data() : null;
  } catch (e) { return null; }
}

// --- RBAC: Upgrade a Coach ---

export async function upgradeToCoach(adminCode) {
  if (adminCode !== ADMIN_UPGRADE_CODE) throw new Error('Código de administrador inválido.');
  const profile = await getUserProfile();
  if (!profile || !profile.clubCode) throw new Error('Primero únete a un club con un código.');
  await saveUserProfile({ ...profile, role: 'coach' });
  return profile.clubCode;
}

// --- GUARDAR RODADA COMPLETADA ---

export async function saveRideToFirestore(ride) {
  const fb = await initFirebase();
  if (!fb || !FBAuth.currentUser) return false;
  try {
    await fb.firestore.addDoc(fb.firestore.collection(fb.db, 'completed_rides'), {
      uid: FBAuth.currentUser.uid,
      timestamp: ride.timestamp,
      title: ride.title || 'Rodada',
      distance: ride.distance || 0,
      duration: ride.duration || 0,
      movingTime: ride.movingTime || 0,
      ascent: ride.ascent || 0,
      avgSpeed: ride.avgSpeed || 0,
      avgHr: ride.avgHr || 0,
      avgCadence: ride.avgCadence || 0,
      avgTemp: ride.avgTemp || 22,
      zoneTimes: ride.zoneTimes || {},
      syncedAt: Date.now()
    });
    return true;
  } catch (e) { console.error('[Firestore] Error guardando rodada:', e); return false; }
}

// --- LIVE TELEMETRY ENGINE (active_rides) ---

export async function updateLiveTelemetry(telemetry) {
  const fb = await initFirebase();
  if (!fb || !FBAuth.currentUser) return;
  const profile = await getUserProfile();
  if (!profile || !profile.broadcastTelemetry || !profile.clubCode) return;
  try {
    const ref = fb.firestore.doc(fb.db, 'active_rides', FBAuth.currentUser.uid);
    await fb.firestore.setDoc(ref, {
      uid: FBAuth.currentUser.uid,
      displayName: profile.displayName || FBAuth.currentUser.email,
      clubCode: profile.clubCode,
      currentLat: telemetry.lat || 0,
      currentLng: telemetry.lon || 0,
      currentSpeed: telemetry.speed || 0,
      currentHR: telemetry.hr || 0,
      currentZone: telemetry.zone || 0,
      cadence: telemetry.cadence || 0,
      distance: telemetry.distance || 0,
      elapsed: telemetry.elapsed || 0,
      emergencyStatus: !!telemetry.emergency,
      updatedAt: Date.now()
    }, { merge: true });
  } catch (e) { console.warn('[Telemetry] Error enviando:', e.message); }
}

export async function clearLiveTelemetry() {
  const fb = await initFirebase();
  if (!fb || !FBAuth.currentUser) return;
  try {
    const ref = fb.firestore.doc(fb.db, 'active_rides', FBAuth.currentUser.uid);
    await fb.firestore.deleteDoc(ref);
  } catch (e) { /* silent */ }
}

// --- COACH DASHBOARD: leer active_rides del club en tiempo real ---

export function subscribeActiveRides(clubCode, callback) {
  const q = fb.firestore.query(
    fb.firestore.collection(fb.db, 'active_rides'),
    fb.firestore.where('clubCode', '==', clubCode)
  );
  return fb.firestore.onSnapshot(q, (snapshot) => {
    const rides = [];
    snapshot.forEach(doc => rides.push(doc.data()));
    callback(rides);
  });
}

// --- Obtener clubCode del perfil (para coach dashboard) ---

export async function getCoachClubCode() {
  const profile = await getUserProfile();
  return (profile && profile.role === 'coach') ? profile.clubCode : null;
}

export { ADMIN_UPGRADE_CODE };
