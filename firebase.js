// firebase.js - Firebase Auth + Firestore (Offline-First) para BiciLog v0.0.5
// Config: reemplazar con las credenciales del proyecto Firebase

const FIREBASE_CONFIG = {
  apiKey: "AIzaSy___________________________",
  authDomain: "bicilog.firebaseapp.com",
  projectId: "bicilog",
  storageBucket: "bicilog.appspot.com",
  messagingSenderId: "000000000000",
  appId: "1:000000000000:web:__________________"
};

let firebaseApp = null;
let firebaseAuth = null;
let firebaseDB = null;

async function initFirebase() {
  if (firebaseApp) return { app: firebaseApp, auth: firebaseAuth, db: firebaseDB };
  try {
    const { initializeApp } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js');
    const { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged } =
      await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js');
    const { getFirestore } =
      await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');

    firebaseApp = initializeApp(FIREBASE_CONFIG);
    firebaseAuth = getAuth(firebaseApp);
    firebaseDB = getFirestore(firebaseApp);

    return {
      app: firebaseApp,
      auth: firebaseAuth,
      db: firebaseDB,
      signInWithEmailAndPassword,
      createUserWithEmailAndPassword,
      signOut,
      onAuthStateChanged
    };
  } catch (e) {
    console.warn('[Firebase] SDK no disponible (offline o red bloqueada):', e.message);
    return null;
  }
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
  }
};

// --- GUARDAR RODADA EN FIRESTORE ---

export async function saveRideToFirestore(ride) {
  const fb = await initFirebase();
  if (!fb || !FBAuth.currentUser) return false;
  try {
    const { addDoc, collection } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
    await addDoc(collection(fb.db, 'completed_rides'), {
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
    console.log('[Firestore] Rodada sincronizada:', ride.title);
    return true;
  } catch (e) {
    console.error('[Firestore] Error al guardar rodada:', e);
    return false;
  }
}

// --- SINCRONIZACIÓN OFFICE-FIRST (usada por el SW via REST) ---

export function getFirebaseConfig() {
  return FIREBASE_CONFIG;
}
