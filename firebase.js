// firebase.js - Firebase Auth + Firestore + Realtime Telemetry para BiciLog v0.0.6
// Config: reemplazar con las credenciales del proyecto Firebase

const FIREBASE_CONFIG = {
  apiKey: "AIzaSy___________________________",
  authDomain: "bicilog.firebaseapp.com",
  projectId: "bicilog",
  storageBucket: "bicilog.appspot.com",
  messagingSenderId: "000000000000",
  appId: "1:000000000000:web:__________________"
};

const ADMIN_UPGRADE_CODE = "COACH2026";

let firebaseApp = null;
let firebaseAuth = null;
let firebaseDB = null;
let firestoreMod = null;

async function initFirebase() {
  if (firebaseApp) return { app: firebaseApp, auth: firebaseAuth, db: firebaseDB, firestore: firestoreMod };
  try {
    const { initializeApp } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js');
    const { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged } =
      await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js');
    const mod = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
    const { getFirestore, doc, setDoc, getDoc, updateDoc, collection, addDoc, query, where, onSnapshot, serverTimestamp, deleteDoc } = mod;
    firestoreMod = { doc, setDoc, getDoc, updateDoc, collection, addDoc, query, where, onSnapshot, serverTimestamp, deleteDoc };

    firebaseApp = initializeApp(FIREBASE_CONFIG);
    firebaseAuth = getAuth(firebaseApp);
    firebaseDB = getFirestore(firebaseApp);

    return {
      app: firebaseApp, auth: firebaseAuth, db: firebaseDB, firestore: firestoreMod,
      signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged
    };
  } catch (e) {
    console.warn('[Firebase] SDK no disponible:', e.message);
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
      displayName: profile.displayName || FBAuth.currentUser.email || '',
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
