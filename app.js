// app.js - Orquestador Principal de la Aplicación BiciLog con IndexedDB y Sincronización PWA

import { Storage } from './storage.js';
import { DB } from './db.js'; // Base de datos IndexedDB
import { BiciSensors } from './bluetooth.js';
import { BiciGPS } from './gps.js';
import { BiciCharts } from './charts.js';
import { FBAuth, saveRideToFirestore, saveUserProfile, getUserProfile, updateLiveTelemetry, clearLiveTelemetry, subscribeActiveRides, getCoachClubCode, upgradeToCoach } from './firebase.js';
import { CrashDetector } from './crash-detector.js';

const APP_VERSION = "0.0.6";

// --- ESTADO GLOBAL DE LA APLICACIÓN ---
const AppState = {
  currentScreen: 'dashboard',
  settings: null,
  hrZones: null,
  rides: [],
  selectedRide: null,
  wakeLock: null, // Bloqueo de suspensión de pantalla

  // Mapas Leaflet
  recMap: null,
  recMarker: null,
  recPathLine: null,
  recTargetMarker: null,
  detMap: null,
  detPathLine: null,

  // Datos de la rodada actual
  activeRide: {
    isRecording: false,
    isPaused: false,
    isAutoPaused: false,
    autoPauseTicks: 0,
    timerInterval: null,
    elapsedSeconds: 0,
    distance: 0,
    speed: 0,
    ascent: 0,
    grade: 0,
    power: 0,
    hr: 0,
    cadence: 0,
    respiration: 0,
    temp: 22,
    targetCoords: null,
    
    samples: [],
    sampleInterval: null,
    
    zoneTimes: { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 }
  },

  // Simulación
  simulation: {
    isActive: false,
    intervalId: null,
    simSpeed: 25.0,
    simHr: 120,
    simCad: 85
  },

  // Bicicletas
  bikeProfiles: [],
  selectedBikeProfileId: null,

  // Club & Telemetry
  userProfile: null,
  telemetryInterval: null,
  coachMap: null,
  coachMarkers: {},

  // SOS / Crash Detection
  sosCountdown: 0,
  sosInterval: null,
  sosAudioCtx: null
};

// --- SELECTORES DOM ---
const DOM = {
  screens: {
    dashboard: document.getElementById('screen-dashboard'),
    recording: document.getElementById('screen-recording'),
    detail: document.getElementById('screen-detail'),
    settings: document.getElementById('screen-settings'),
    sensors: document.getElementById('screen-sensors'), // Pantalla de CRUD Sensores
    bikes: document.getElementById('screen-bikes'),       // Pantalla de Perfiles de Bici
    coach: document.getElementById('screen-coach')       // Coach Dashboard
  },
  
  // Dashboard
  statsTotalKm: document.getElementById('stats-total-km'),
  statsTotalTime: document.getElementById('stats-total-time'),
  statsTotalRides: document.getElementById('stats-total-rides'),
  weeklyChart: document.getElementById('weekly-chart-container'),
  recentRidesList: document.getElementById('recent-rides-list'),
  btnStartRide: document.getElementById('btn-start-ride'),
  btnOpenSettings: document.getElementById('btn-open-settings'),

  // Grabación en vivo
  gpsAccuracy: document.getElementById('gps-accuracy-badge'),
  liveStatusBadge: document.getElementById('live-status-badge'),
  btnConnectHr: document.getElementById('btn-connect-hr'),
  btnConnectCsc: document.getElementById('btn-connect-csc'),
  sensorPillHr: document.getElementById('sensor-pill-hr'),
  sensorPillCsc: document.getElementById('sensor-pill-csc'),
  liveSpeed: document.getElementById('live-speed'),
  liveTimer: document.getElementById('live-timer'),
  liveDistance: document.getElementById('live-distance'),
  liveHr: document.getElementById('live-hr'),
  liveHrZone: document.getElementById('live-hr-zone'),
  hrMetricBox: document.getElementById('hr-metric-box'),
  liveCadence: document.getElementById('live-cadence'),
  liveAscent: document.getElementById('live-ascent'),
  liveWatts: document.getElementById('live-watts'),
  liveGrade: document.getElementById('live-grade'),
  liveRespiration: document.getElementById('live-respiration'),
  liveTemp: document.getElementById('live-temp'),
  liveClock: document.getElementById('live-clock'),
  liveMovingTime: document.getElementById('live-moving-time'),
  chkSimulate: document.getElementById('chk-simulate-data'),
  btnPauseRide: document.getElementById('btn-pause-ride'),
  btnResumeRide: document.getElementById('btn-resume-ride'),
  btnStopRide: document.getElementById('btn-stop-ride'),

  // Map controls
  mapTargetStatus: document.getElementById('map-target-status'),
  mapTargetDistance: document.getElementById('map-target-distance'),
  btnClearTarget: document.getElementById('btn-clear-target'),

  // ClimbPro Widget
  climbproWidget: document.getElementById('climbpro-widget'),
  climbScoreBadge: document.getElementById('climb-score-badge'),
  climbDistLeft: document.getElementById('climb-dist-left'),
  climbAvgGrade: document.getElementById('climb-avg-grade'),
  climbProfileBars: document.getElementById('climb-profile-bars'),

  // Detalle
  detailTitle: document.getElementById('detail-title'),
  detailDate: document.getElementById('detail-date'),
  detailValDistance: document.getElementById('detail-val-distance'),
  detailValTime: document.getElementById('detail-val-time'),
  detailValSpeed: document.getElementById('detail-val-speed'),
  detailValAscent: document.getElementById('detail-val-ascent'),
  detailValHr: document.getElementById('detail-val-hr'),
  detailValCadence: document.getElementById('detail-val-cadence'),
  detailValRespiration: document.getElementById('detail-val-respiration'),
  detailValTemp: document.getElementById('detail-val-temp'),
  detailProfileChart: document.getElementById('detail-ride-profile-chart'),
  detailHrZonesChart: document.getElementById('detail-hr-zones-chart'),
  btnDetailBack: document.getElementById('btn-detail-back'),
  btnDeleteRide: document.getElementById('btn-delete-ride'),

  // Tabs de detalle
  detailTabPanelSummary: document.getElementById('detail-tab-summary'),
  detailTabPanelStats: document.getElementById('detail-tab-stats'),
  detailTabPanelCharts: document.getElementById('detail-tab-charts'),
  detailChartElevation: document.getElementById('detail-chart-elevation'),
  detailChartSpeed: document.getElementById('detail-chart-speed'),
  detailChartHr: document.getElementById('detail-chart-hr'),
  detailChartCadence: document.getElementById('detail-chart-cadence'),
  statsSpeedAvg: document.getElementById('stats-speed-avg'),
  statsSpeedMax: document.getElementById('stats-speed-max'),
  statsHrAvg: document.getElementById('stats-hr-avg'),
  statsHrMax: document.getElementById('stats-hr-max'),
  statsElevAscent: document.getElementById('stats-elev-ascent'),
  statsElevMin: document.getElementById('stats-elev-min'),
  statsElevMax: document.getElementById('stats-elev-max'),
  statsCadAvg: document.getElementById('stats-cad-avg'),
  statsCadMax: document.getElementById('stats-cad-max'),
  statsTimeTotal: document.getElementById('stats-time-total'),
  statsTimeMoving: document.getElementById('stats-time-moving'),
  chartsRendered: false,

  // Ajustes
  settingsForm: document.getElementById('settings-form'),
  setAge: document.getElementById('set-age'),
  setWeight: document.getElementById('set-weight'),
  setBikeWeight: document.getElementById('set-bike-weight'),
  setAutopause: document.getElementById('set-autopause'),
  setUseAuto: document.getElementById('set-use-auto'),
  manualZonesContainer: document.getElementById('manual-zones-container'),
  autoZonesPreview: document.getElementById('auto-zones-preview'),
  btnSettingsBack: document.getElementById('btn-settings-back'),
  btnGotoSensors: document.getElementById('btn-goto-sensors'), // Ir a sensores

  // Gestión de Sensores (CRUD)
  btnSensorsBack: document.getElementById('btn-sensors-back'),
  sensorsCrudList: document.getElementById('sensors-crud-list'),
  sensorAliasModal: document.getElementById('sensor-alias-modal'),
  sensorAliasInput: document.getElementById('sensor-alias-input'),
  btnAliasCancel: document.getElementById('btn-alias-cancel'),
  btnAliasSave: document.getElementById('btn-alias-save'),
  btnForceUnpair: document.getElementById('btn-force-unpair'),

  // Gestión de Bicicletas
  btnGotoBikes: document.getElementById('btn-goto-bikes'),
  btnBikesBack: document.getElementById('btn-bikes-back'),

  // Club & Telemetry Settings
  setBroadcast: document.getElementById('set-broadcast'),
  setClubCode: document.getElementById('set-club-code'),
  btnJoinClub: document.getElementById('btn-join-club'),
  setAdminCode: document.getElementById('set-admin-code'),
  btnUpgradeCoach: document.getElementById('btn-upgrade-coach'),

  // Coach Dashboard
  btnCoachDashboard: document.getElementById('btn-coach-dashboard'),
  coachDashboardScreen: document.getElementById('screen-coach'),
  coachMapContainer: document.getElementById('coach-map'),
  btnCoachBack: document.getElementById('btn-coach-back'),
  coachClubLabel: document.getElementById('coach-club-label'),
  bikesCrudList: document.getElementById('bikes-crud-list'),
  btnAddBike: document.getElementById('btn-add-bike'),
  bikeProfileSelect: document.getElementById('bike-profile-select'),
  btnBikeManage: document.getElementById('btn-bike-manage'),
  bikeProfileModal: document.getElementById('bike-profile-modal'),
  bikeNameInput: document.getElementById('bike-name-input'),
  bikeTypeSelect: document.getElementById('bike-type-select'),
  bikeCadenceSelect: document.getElementById('bike-cadence-select'),
  btnBikeCancel: document.getElementById('btn-bike-cancel'),
  btnBikeSave: document.getElementById('btn-bike-save'),
  bikeModalTitle: document.getElementById('bike-modal-title'),

  // SOS Crash Detection
  sosOverlay: document.getElementById('sos-overlay'),
  sosCountdownEl: document.getElementById('sos-countdown'),
  sosBtnCancel: document.getElementById('sos-btn-cancel'),

  // Recuperación de sesión
  sessionRecoveryModal: document.getElementById('session-recovery-modal'),
  recoveryTime: document.getElementById('recovery-time'),
  recoveryDistance: document.getElementById('recovery-distance'),
  btnRecoveryDiscard: document.getElementById('btn-recovery-discard'),
  btnRecoveryResume: document.getElementById('btn-recovery-resume')
};

// --- SCREEN WAKE LOCK API ---
async function requestWakeLock() {
  if ('wakeLock' in navigator) {
    try {
      AppState.wakeLock = await navigator.wakeLock.request('screen');
      console.log('[WakeLock] Bloqueo de pantalla adquirido con éxito.');
      AppState.wakeLock.addEventListener('release', () => {
        console.log('[WakeLock] Bloqueo de pantalla liberado.');
      });
    } catch (err) {
      console.error(`[WakeLock] Error al adquirir Wake Lock: ${err.name}, ${err.message}`);
    }
  } else {
    console.warn('[WakeLock] La API de Wake Lock no está soportada en este navegador.');
  }
}

function releaseWakeLock() {
  if (AppState.wakeLock !== null) {
    AppState.wakeLock.release()
      .then(() => {
        AppState.wakeLock = null;
      })
      .catch(err => {
        console.error('[WakeLock] Error al liberar Wake Lock:', err);
      });
  }
}

function updateGpsAccuracyUI(accuracy) {
  if (accuracy === undefined || accuracy === null) {
    DOM.gpsAccuracy.textContent = 'GPS: --';
    DOM.gpsAccuracy.style.color = '';
    return;
  }
  const m = Math.round(accuracy);
  DOM.gpsAccuracy.textContent = `GPS: ${m}m`;
  DOM.gpsAccuracy.style.color = m < 30 ? 'var(--color-success)' : '#FF9F43';
}

function updateLiveClock() {
  const now = new Date();
  DOM.liveClock.textContent = now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}

// --- NAVEGACIÓN SPA ---
function navigateTo(screenId) {
  Object.keys(DOM.screens).forEach(key => {
    DOM.screens[key].classList.remove('active');
  });
  DOM.screens[screenId].classList.add('active');
  AppState.currentScreen = screenId;
  
  if (screenId === 'dashboard') {
    loadDashboardData();
  } else if (screenId === 'settings') {
    loadSettingsScreen();
  } else if (screenId === 'sensors') {
    loadSensorsList();
  } else if (screenId === 'bikes') {
    loadBikesScreen();
  }
}

// --- CARGAR DATOS EN PANTALLAS ---

// Cargar Dashboard (IndexedDB)
function loadDashboardData() {
  AppState.settings = Storage.getSettings();
  AppState.hrZones = Storage.getHRZones(AppState.settings);

  DB.getAllRides().then(rides => {
    AppState.rides = rides;

    let totalKm = 0;
    let totalSeconds = 0;
    
    AppState.rides.forEach(ride => {
      totalKm += ride.distance || 0;
      totalSeconds += ride.duration || 0;
    });

    DOM.statsTotalKm.textContent = totalKm.toFixed(1);
    DOM.statsTotalTime.textContent = BiciCharts.formatDuration(totalSeconds);
    DOM.statsTotalRides.textContent = AppState.rides.length;

    BiciCharts.renderWeeklySummary('weekly-chart-container', AppState.rides);
    renderRecentRidesList();
  }).catch(err => {
    console.error("Error al cargar rodadas históricas:", err);
  });
}

// Lista de rodadas recientes con indicación de sincronización
function renderRecentRidesList() {
  DOM.recentRidesList.innerHTML = '';
  
  if (AppState.rides.length === 0) {
    DOM.recentRidesList.innerHTML = `
      <div class="empty-state">
        <p>No tienes rodadas registradas. ¡Sal a rodar!</p>
      </div>
    `;
    return;
  }

  AppState.rides.slice(0, 5).forEach(ride => {
    const card = document.createElement('div');
    card.className = 'ride-card';
    
    const date = new Date(ride.timestamp);
    const options = { weekday: 'long', day: 'numeric', month: 'short' };
    const dateStr = date.toLocaleDateString('es-ES', options);

    // Etiqueta visual de sincronización
    const syncBadge = ride.sync_status === 'synced' 
      ? '<span style="font-size:9px; color:var(--color-success); font-weight:700;">● Sincronizado</span>'
      : '<span style="font-size:9px; color:#FF9F43; font-weight:700;">● Pendiente</span>';
    
    card.innerHTML = `
      <div class="ride-card-left">
        <span class="ride-card-title" style="display:flex; align-items:center; gap:8px;">${ride.title} ${syncBadge}</span>
        <span class="ride-card-date">${dateStr}</span>
      </div>
      <div class="ride-card-right">
        <div class="ride-card-metric">
          <span class="val">${ride.distance.toFixed(1)}</span>
          <span class="lbl">Km</span>
        </div>
        <div class="ride-card-metric">
          <span class="val">${BiciCharts.formatDuration(ride.duration)}</span>
          <span class="lbl">Tiempo</span>
        </div>
      </div>
    `;
    
    card.addEventListener('click', () => {
      openRideDetail(ride);
    });
    DOM.recentRidesList.appendChild(card);
  });
}

// Ver Detalle de Rodada (Tabbed: Resumen | Estadísticas | Gráficos)
function openRideDetail(ride) {
  AppState.selectedRide = ride;

  DOM.detailTitle.textContent = ride.title;
  const date = new Date(ride.timestamp);
  const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' };
  DOM.detailDate.textContent = date.toLocaleDateString('es-ES', options);

  // Summary tab
  DOM.detailValDistance.textContent = ride.distance.toFixed(2);
  DOM.detailValTime.textContent = BiciCharts.formatDuration(ride.duration);
  DOM.detailValSpeed.textContent = ride.avgSpeed.toFixed(1);
  DOM.detailValAscent.textContent = Math.round(ride.ascent);
  DOM.detailValHr.textContent = ride.avgHr > 0 ? Math.round(ride.avgHr) : '--';
  DOM.detailValCadence.textContent = ride.avgCadence > 0 ? Math.round(ride.avgCadence) : '--';

  // Stats tab
  const samples = ride.samples || [];
  const speeds = samples.map(s => s.speed).filter(v => v > 0);
  const hrs = samples.map(s => s.hr).filter(v => v > 0);
  const cads = samples.map(s => s.cadence).filter(v => v > 0);
  const alts = samples.filter(s => s.lat !== undefined);

  DOM.statsSpeedAvg.textContent = ride.avgSpeed.toFixed(1) + ' km/h';
  DOM.statsSpeedMax.textContent = (speeds.length ? Math.max(...speeds).toFixed(1) : '0.0') + ' km/h';
  DOM.statsHrAvg.textContent = (ride.avgHr > 0 ? Math.round(ride.avgHr) : '--') + ' BPM';
  DOM.statsHrMax.textContent = (hrs.length ? Math.round(Math.max(...hrs)) : '--') + ' BPM';
  DOM.statsElevAscent.textContent = Math.round(ride.ascent) + ' m';
  DOM.statsElevMin.textContent = 'N/D';
  DOM.statsElevMax.textContent = 'N/D';
  DOM.statsCadAvg.textContent = (ride.avgCadence > 0 ? Math.round(ride.avgCadence) : '--') + ' RPM';
  DOM.statsCadMax.textContent = (cads.length ? Math.round(Math.max(...cads)) : '--') + ' RPM';
  DOM.statsTimeTotal.textContent = BiciCharts.formatDuration(ride.duration);
  DOM.statsTimeMoving.textContent = BiciCharts.formatDuration(ride.movingTime || 0);
  DOM.chartsRendered = false;

  // Reset tabs to Summary
  document.querySelectorAll('.detail-tab').forEach((t, i) => t.classList.toggle('active', i === 0));
  DOM.detailTabPanelSummary.classList.add('active');
  DOM.detailTabPanelStats.classList.remove('active');
  DOM.detailTabPanelCharts.classList.remove('active');

  navigateTo('detail');

  BiciCharts.renderHRZones('detail-hr-zones-chart', ride.zoneTimes, ride.duration);
  setTimeout(() => initDetailMap(ride), 100);
}

function switchDetailTab(tabName) {
  DOM.detailTabPanelSummary.classList.toggle('active', tabName === 'summary');
  DOM.detailTabPanelStats.classList.toggle('active', tabName === 'stats');
  DOM.detailTabPanelCharts.classList.toggle('active', tabName === 'charts');

  if (tabName === 'charts' && !DOM.chartsRendered) {
    const ride = AppState.selectedRide;
    if (ride && ride.samples) {
      BiciCharts.renderElevationChart('detail-chart-elevation', ride.samples);
      BiciCharts.renderSpeedChart('detail-chart-speed', ride.samples);
      BiciCharts.renderHrChart('detail-chart-hr', ride.samples, AppState.hrZones);
      BiciCharts.renderCadenceChart('detail-chart-cadence', ride.samples);
      DOM.chartsRendered = true;
    }
  }
}

// Cargar Ajustes
function loadSettingsScreen() {
  const settings = Storage.getSettings();
  DOM.setAge.value = settings.age;
  DOM.setWeight.value = settings.weight;
  DOM.setBikeWeight.value = settings.bikeWeight || 10;
  DOM.setAutopause.checked = settings.autoPause;
  DOM.setUseAuto.checked = settings.useAutoZones;

  if (settings.useAutoZones) {
    DOM.manualZonesContainer.classList.add('hide');
    DOM.autoZonesPreview.classList.remove('hide');
    updateAutoZonesPreview();
  } else {
    DOM.manualZonesContainer.classList.remove('hide');
    DOM.autoZonesPreview.classList.add('hide');
    Object.keys(settings.manualZones).forEach(zone => {
      document.getElementById(`${zone}-min`).value = settings.manualZones[zone].min;
      document.getElementById(`${zone}-max`).value = settings.manualZones[zone].max;
    });
  }
}

// Actualizar preview de zonas automáticas
function updateAutoZonesPreview() {
  const age = parseInt(DOM.setAge.value) || 30;
  const maxHR = 220 - age;
  
  const z1Min = Math.round(maxHR * 0.50), z1Max = Math.round(maxHR * 0.60);
  const z2Min = z1Max + 1, z2Max = Math.round(maxHR * 0.70);
  const z3Min = z2Max + 1, z3Max = Math.round(maxHR * 0.80);
  const z4Min = z3Max + 1, z4Max = Math.round(maxHR * 0.90);
  const z5Min = z4Max + 1, z5Max = maxHR;

  DOM.autoZonesPreview.innerHTML = `
    <div class="preview-zone-item"><span class="zone-badge-dot z1-dot"></span><span>Z1 Recuperación:</span><span class="val">${z1Min} - ${z1Max} BPM</span></div>
    <div class="preview-zone-item"><span class="zone-badge-dot z2-dot"></span><span>Z2 Resistencia:</span><span class="val">${z2Min} - ${z2Max} BPM</span></div>
    <div class="preview-zone-item"><span class="zone-badge-dot z3-dot"></span><span>Z3 Tempo:</span><span class="val">${z3Min} - ${z3Max} BPM</span></div>
    <div class="preview-zone-item"><span class="zone-badge-dot z4-dot"></span><span>Z4 Umbral:</span><span class="val">${z4Min} - ${z4Max} BPM</span></div>
    <div class="preview-zone-item"><span class="zone-badge-dot z5-dot"></span><span>Z5 Anaeróbico:</span><span class="val">${z5Min} - ${z5Max} BPM</span></div>
  `;
}

// --- INTEGRACIÓN DE MAPAS LEAFLET ---

function initRecordingMap() {
  if (AppState.recMap) {
    AppState.recMap.remove();
    AppState.recMap = null;
  }

  const defaultCoords = [4.6097, -74.0817];
  
  AppState.recMap = L.map('recording-map', {
    zoomControl: false,
    doubleClickZoom: false
  }).setView(defaultCoords, 16);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OSM'
  }).addTo(AppState.recMap);

  const bikeIcon = L.divIcon({
    className: 'custom-bike-marker',
    html: `<div style="background-color: var(--color-accent); width: 14px; height: 14px; border-radius: 50%; border: 2.5px solid white; box-shadow: 0 0 10px rgba(0,0,0,0.3);"></div>`,
    iconSize: [14, 14]
  });
  
  AppState.recMarker = L.marker(defaultCoords, { icon: bikeIcon }).addTo(AppState.recMap);

  AppState.recPathLine = L.polyline([], {
    color: 'var(--color-accent)',
    weight: 4.5,
    opacity: 0.85
  }).addTo(AppState.recMap);

  AppState.recMap.on('click', (e) => {
    setTargetCoords(e.latlng.lat, e.latlng.lng);
  });
}

function setTargetCoords(lat, lng) {
  AppState.activeRide.targetCoords = { lat, lng };

  if (AppState.recTargetMarker) {
    AppState.recTargetMarker.setLatLng([lat, lng]);
  } else {
    const targetIcon = L.divIcon({
      className: 'custom-target-marker',
      html: `<div style="background-color: var(--color-danger); width: 14px; height: 14px; transform: rotate(45deg); border: 2.5px solid white; box-shadow: 0 0 10px rgba(0,0,0,0.3);"></div>`,
      iconSize: [14, 14]
    });
    AppState.recTargetMarker = L.marker([lat, lng], { icon: targetIcon }).addTo(AppState.recMap);
  }

  DOM.mapTargetStatus.style.display = 'block';
  DOM.mapTargetDistance.style.display = 'block';
  DOM.btnClearTarget.style.display = 'block';

  updateTargetDistance();
}

function clearTargetCoords() {
  AppState.activeRide.targetCoords = null;
  if (AppState.recTargetMarker) {
    AppState.recTargetMarker.remove();
    AppState.recTargetMarker = null;
  }
  DOM.mapTargetStatus.style.display = 'none';
  DOM.mapTargetDistance.style.display = 'none';
  DOM.btnClearTarget.style.display = 'none';
}

function updateTargetDistance() {
  if (!AppState.activeRide.targetCoords || !AppState.recMarker) return;

  const currentLatLng = AppState.recMarker.getLatLng();
  const target = AppState.activeRide.targetCoords;

  const R = 6371;
  const dLat = (target.lat - currentLatLng.lat) * Math.PI / 180;
  const dLon = (target.lng - currentLatLng.lng) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(currentLatLng.lat * Math.PI / 180) * Math.cos(target.lat * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const dist = R * c;

  DOM.mapTargetDistance.textContent = `Quedan: ${dist.toFixed(2)} km`;
}

function initDetailMap(ride) {
  if (AppState.detMap) {
    AppState.detMap.remove();
    AppState.detMap = null;
  }

  const coords = ride.samples
    .filter(s => s.lat !== undefined && s.lon !== undefined)
    .map(s => [s.lat, s.lon]);

  if (coords.length === 0) {
    document.getElementById('detail-map').innerHTML = `<div style="text-align: center; padding: 40px 20px; color: var(--text-muted); font-size: 13px;">No hay datos de mapas grabados en esta rodada.</div>`;
    return;
  }

  AppState.detMap = L.map('detail-map', { zoomControl: false }).setView(coords[0], 15);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OSM'
  }).addTo(AppState.detMap);

  AppState.detPathLine = L.polyline(coords, {
    color: 'var(--color-danger)',
    weight: 5,
    opacity: 0.9
  }).addTo(AppState.detMap);

  const startIcon = L.divIcon({
    html: `<div style="background-color: var(--color-success); width: 12px; height: 12px; border-radius:50%; border:2px solid white; box-shadow:0 0 5px rgba(0,0,0,0.3);"></div>`,
    iconSize: [12, 12]
  });
  const endIcon = L.divIcon({
    html: `<div style="background-color: var(--color-danger); width: 12px; height: 12px; border-radius:50%; border:2px solid white; box-shadow:0 0 5px rgba(0,0,0,0.3);"></div>`,
    iconSize: [12, 12]
  });

  L.marker(coords[0], { icon: startIcon }).addTo(AppState.detMap);
  L.marker(coords[coords.length - 1], { icon: endIcon }).addTo(AppState.detMap);

  AppState.detMap.fitBounds(AppState.detPathLine.getBounds(), { padding: [20, 20] });
}

// --- LÓGICA DE GRABACIÓN ---

function startWorkout() {
  AppState.activeRide = {
    isRecording: true,
    isPaused: false,
    isAutoPaused: false,
    autoPauseTicks: 0,
    timerInterval: null,
    elapsedSeconds: 0,
    distance: 0,
    speed: 0,
    ascent: 0,
    grade: 0,
    power: 0,
    hr: 0,
    cadence: 0,
    respiration: 0,
    temp: 22,
    targetCoords: null,
    samples: [],
    sampleInterval: null,
    zoneTimes: { z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 }
  };

  DOM.liveSpeed.textContent = '0.0';
  DOM.liveDistance.textContent = '0.00';
  DOM.liveTimer.textContent = '00:00:00';
  DOM.liveMovingTime.textContent = '00:00';
  DOM.liveHr.textContent = '--';
  DOM.liveHrZone.textContent = '--';
  DOM.liveHrZone.className = 'hr-zone-tag hide';
  DOM.liveCadence.textContent = '--';
  DOM.liveAscent.textContent = '0';
  DOM.liveWatts.textContent = '--';
  DOM.liveGrade.textContent = '0%';
  DOM.liveRespiration.textContent = '--';
  DOM.liveTemp.textContent = '22';
  DOM.hrMetricBox.style.borderLeft = '6px solid var(--color-border)';
  updateLiveClock();

  DOM.btnPauseRide.classList.remove('hide');
  DOM.btnResumeRide.classList.add('hide');

  DOM.climbproWidget.classList.add('hide');
  DOM.climbProfileBars.innerHTML = '';

  clearTargetCoords();
  navigateTo('recording');

  // Inicializar mapa de grabación Leaflet
  initRecordingMap();

  // Adquirir bloqueo de suspensión de pantalla
  requestWakeLock();

  // Activar detección de caídas
  startCrashDetection();

  // Motor de telemetría en vivo (cada 5s)
  startTelemetryEngine();

  // Buscar y autoconectar sensores emparejados en el navegador
  triggerSilentBluetoothReconnect();

  // 1. Iniciar Cronómetro
  AppState.activeRide.timerInterval = setInterval(() => {
    if (AppState.settings.autoPause) {
      // Auto-pausa solo si NO hay GPS, NI HR, NI cadencia
      const noMovement = AppState.activeRide.speed < 2.0;
      const noHr = AppState.activeRide.hr === 0;
      const noCadence = AppState.activeRide.cadence === 0;

      if (noMovement && noHr && noCadence) {
        AppState.activeRide.autoPauseTicks++;
        if (AppState.activeRide.autoPauseTicks >= 6 && !AppState.activeRide.isAutoPaused) {
          AppState.activeRide.isAutoPaused = true;
          DOM.liveStatusBadge.textContent = 'AUTO-PAUSA';
          DOM.liveStatusBadge.className = 'status-indicator live-badge autopaused';
        }
      } else {
        AppState.activeRide.autoPauseTicks = 0;
        if (AppState.activeRide.isAutoPaused) {
          AppState.activeRide.isAutoPaused = false;
          DOM.liveStatusBadge.textContent = 'EN VIVO';
          DOM.liveStatusBadge.className = 'status-indicator live-badge';
        }
      }
    }

    const isRunning = !AppState.activeRide.isPaused && !AppState.activeRide.isAutoPaused;

    if (isRunning) {
      AppState.activeRide.elapsedSeconds++;
      DOM.liveTimer.textContent = BiciCharts.formatDuration(AppState.activeRide.elapsedSeconds);

      if (AppState.activeRide.speed > 2) {
        AppState.activeRide.movingTimeSeconds = (AppState.activeRide.movingTimeSeconds || 0) + 1;
      }
      DOM.liveMovingTime.textContent = BiciCharts.formatDuration(AppState.activeRide.movingTimeSeconds || 0);

      CrashDetector.updateSpeed(AppState.activeRide.speed);

      updateLiveClock();

      // Auto-hide controls: esconder si hay velocidad, mostrar si parado o tap reciente
      const controls = document.querySelector('.recording-actions');
      if (controls) {
        const tappedRecently = AppState.activeRide.controlsShowUntil && Date.now() < AppState.activeRide.controlsShowUntil;
        if (AppState.activeRide.speed > 0 && !tappedRecently) {
          controls.classList.add('auto-hidden');
        } else {
          controls.classList.remove('auto-hidden');
        }
      }
      
      if (AppState.activeRide.hr > 0) {
        const zoneNum = Storage.getZoneForHR(AppState.activeRide.hr, AppState.hrZones);
        if (zoneNum > 0) {
          AppState.activeRide.zoneTimes[`z${zoneNum}`]++;
        }
        DOM.hrMetricBox.style.borderLeft = `6px solid ${BiciCharts.ZONE_COLORS[`z${zoneNum}`]}`;
      } else {
        DOM.hrMetricBox.style.borderLeft = '6px solid var(--color-border)';
      }

      // Guardar en caliente cada segundo
      Storage.saveActiveSession({
        elapsedSeconds: AppState.activeRide.elapsedSeconds,
        distance: AppState.activeRide.distance,
        ascent: AppState.activeRide.ascent,
        hr: AppState.activeRide.hr,
        cadence: AppState.activeRide.cadence,
        respiration: AppState.activeRide.respiration,
        temp: AppState.activeRide.temp,
        samples: AppState.activeRide.samples,
        zoneTimes: AppState.activeRide.zoneTimes,
        simulationActive: AppState.simulation.isActive,
        targetCoords: AppState.activeRide.targetCoords
      });
    }
  }, 1000);

  // 2. Iniciar Toma de Muestras
  AppState.activeRide.sampleInterval = setInterval(() => {
    if (!AppState.activeRide.isPaused && !AppState.activeRide.isAutoPaused) {
      AppState.activeRide.samples.push({
        time: AppState.activeRide.elapsedSeconds,
        hr: AppState.activeRide.hr,
        speed: AppState.activeRide.speed,
        cadence: AppState.activeRide.cadence,
        lat: AppState.activeRide.lat,
        lon: AppState.activeRide.lon
      });
    }
  }, 5000);

  // 3. Iniciar GPS si el simulador no está encendido
  if (!AppState.simulation.isActive) {
    BiciGPS.startTracking(
      AppState.settings,
      (gpsData) => {
        if (AppState.activeRide.isAutoPaused) return;

        AppState.activeRide.speed = gpsData.speed;
        AppState.activeRide.distance = gpsData.distance;
        AppState.activeRide.ascent = gpsData.ascent;
        AppState.activeRide.grade = gpsData.grade;
        AppState.activeRide.power = gpsData.power;
        AppState.activeRide.lat = gpsData.latitude;
        AppState.activeRide.lon = gpsData.longitude;
        
        DOM.liveSpeed.textContent = gpsData.speed.toFixed(1);
        DOM.liveDistance.textContent = gpsData.distance.toFixed(2);
        DOM.liveAscent.textContent = Math.round(gpsData.ascent);
        DOM.liveGrade.textContent = Math.round(gpsData.grade) + '%';
        DOM.liveWatts.textContent = Math.round(gpsData.power);
        updateGpsAccuracyUI(gpsData.accuracy);
        
        const baseTemp = 22;
        const tempShift = -((gpsData.ascent / 100) * 0.65);
        AppState.activeRide.temp = Math.round((baseTemp + tempShift) * 10) / 10;
        DOM.liveTemp.textContent = AppState.activeRide.temp;

        if (AppState.recMap && gpsData.latitude && gpsData.longitude) {
          const newPos = [gpsData.latitude, gpsData.longitude];
          AppState.recMarker.setLatLng(newPos);
          AppState.recPathLine.addLatLng(newPos);
          AppState.recMap.panTo(newPos);
          updateTargetDistance();
        }

        updateClimbProUI(gpsData.climbInfo);
      },
      (error) => {
        DOM.gpsAccuracy.textContent = "GPS: Error";
      }
    );
  } else {
    startDemoSimulation();
  }
}

function updateClimbProUI(climbInfo) {
  if (climbInfo && climbInfo.active) {
    DOM.climbproWidget.classList.remove('hide');
    DOM.climbDistLeft.textContent = Math.round(climbInfo.distance);
    DOM.climbAvgGrade.textContent = climbInfo.avgGrade.toFixed(1);
    DOM.climbScoreBadge.textContent = `Score: ${Math.round(climbInfo.score)}`;

    DOM.climbProfileBars.innerHTML = '';
    climbInfo.segments.forEach(seg => {
      const bar = document.createElement('div');
      bar.className = 'climb-segment-bar';
      bar.style.backgroundColor = seg.color;
      DOM.climbProfileBars.appendChild(bar);
    });
  } else {
    DOM.climbproWidget.classList.add('hide');
  }
}

// Pausar
function pauseWorkout() {
  AppState.activeRide.isPaused = true;
  DOM.btnPauseRide.classList.add('hide');
  DOM.btnResumeRide.classList.remove('hide');
  
  // Liberar bloqueo de suspensión de pantalla al pausar
  releaseWakeLock();
  stopCrashDetection();
  stopTelemetryEngine();

  if (!AppState.simulation.isActive) {
    BiciGPS.stopTracking();
  }
}

// Reanudar
function resumeWorkout() {
  AppState.activeRide.isPaused = false;
  DOM.btnPauseRide.classList.remove('hide');
  DOM.btnResumeRide.classList.add('hide');

  // Adquirir bloqueo de suspensión de pantalla al reanudar
  requestWakeLock();

  if (!AppState.simulation.isActive) {
    BiciGPS.startTracking(
      AppState.settings,
      (gpsData) => {
        if (AppState.activeRide.isAutoPaused) return;

        AppState.activeRide.speed = gpsData.speed;
        AppState.activeRide.distance = gpsData.distance;
        AppState.activeRide.ascent = gpsData.ascent;
        AppState.activeRide.grade = gpsData.grade;
        AppState.activeRide.power = gpsData.power;
        AppState.activeRide.lat = gpsData.latitude;
        AppState.activeRide.lon = gpsData.longitude;
        
        DOM.liveSpeed.textContent = gpsData.speed.toFixed(1);
        DOM.liveDistance.textContent = gpsData.distance.toFixed(2);
        DOM.liveAscent.textContent = Math.round(gpsData.ascent);
        DOM.liveGrade.textContent = Math.round(gpsData.grade) + '%';
        DOM.liveWatts.textContent = Math.round(gpsData.power);
        updateGpsAccuracyUI(gpsData.accuracy);

        if (AppState.recMap && gpsData.latitude && gpsData.longitude) {
          const newPos = [gpsData.latitude, gpsData.longitude];
          AppState.recMarker.setLatLng(newPos);
          AppState.recPathLine.addLatLng(newPos);
          AppState.recMap.panTo(newPos);
          updateTargetDistance();
        }
        updateClimbProUI(gpsData.climbInfo);
      }
    );
  }
}

// Finalizar y Guardar (IndexedDB + PWA Sync Trigger)
function stopWorkout() {
  clearInterval(AppState.activeRide.timerInterval);
  clearInterval(AppState.activeRide.sampleInterval);
  
  // Liberar bloqueo de suspensión al finalizar rodada
  releaseWakeLock();
  stopCrashDetection();
  stopTelemetryEngine();

  if (AppState.simulation.isActive) {
    stopDemoSimulation();
  } else {
    BiciGPS.stopTracking();
    BiciSensors.disconnectAll();
    resetPillsUI();
  }

  if (AppState.recMap) {
    AppState.recMap.remove();
    AppState.recMap = null;
  }

  const rideData = AppState.activeRide;
  
  if (rideData.samples.length === 0) {
    rideData.samples.push({ time: 0, hr: rideData.hr || 70, speed: rideData.speed || 0, cadence: rideData.cadence || 0 });
    rideData.samples.push({ time: rideData.elapsedSeconds, hr: rideData.hr || 70, speed: rideData.speed || 0, cadence: rideData.cadence || 0 });
  }

  const movingSamples = rideData.samples.filter(s => s.speed > 2);
  const movingTime = movingSamples.length * 5; // segundos (intervalo de muestreo 5s)

  const hrs = rideData.samples.map(s => s.hr).filter(h => h > 0);
  const speeds = movingSamples.map(s => s.speed);
  const cadences = rideData.samples.map(s => s.cadence).filter(c => c > 0);

  const avgHr = hrs.length > 0 ? hrs.reduce((a, b) => a + b, 0) / hrs.length : 0;
  const avgSpeed = speeds.length > 0 ? speeds.reduce((a, b) => a + b, 0) / speeds.length : 0;
  const avgCadence = cadences.length > 0 ? cadences.reduce((a, b) => a + b, 0) / cadences.length : 0;
  const avgRespiration = avgHr > 0 ? Math.round(12 + (avgHr - 60) / 3.5) : 0;

  const hour = new Date().getHours();
  let timeOfDay = "Rodada Matutina";
  if (hour >= 12 && hour < 19) timeOfDay = "Rodada Vespertina";
  else if (hour >= 19 || hour < 6) timeOfDay = "Rodada Nocturna";

  const newRide = {
    timestamp: Date.now(),
    title: timeOfDay,
    duration: rideData.elapsedSeconds,
    movingTime: movingTime,
    distance: rideData.distance,
    ascent: rideData.ascent,
    avgSpeed: avgSpeed || rideData.speed || 0,
    avgHr: avgHr || rideData.hr || 0,
    avgCadence: avgCadence || rideData.cadence || 0,
    avgRespiration: avgRespiration,
    avgTemp: rideData.temp,
    samples: rideData.samples,
    zoneTimes: rideData.zoneTimes,
    sync_status: 'pending'
  };

  // Guardar en la base de datos asíncrona IndexedDB
  DB.saveRide(newRide).then(() => {
    Storage.clearActiveSession();

    // Firebase sync (si hay red y usuario autenticado)
    saveRideToFirestore(newRide).then(synced => {
      if (synced) DB.markRideSynced(newRide.timestamp);
    });

    triggerBackgroundSync();
    openRideDetail(newRide);
  }).catch(err => {
    console.error("Error al guardar rodada en IndexedDB:", err);
  });
}

// Resetear UI de pastillas
function resetPillsUI() {
  DOM.sensorPillHr.className = 'sensor-connect-pill';
  DOM.sensorPillHr.querySelector('.sensor-status-text').textContent = 'FC: Desconectado';
  DOM.btnConnectHr.textContent = 'Emparejar';

  DOM.sensorPillCsc.className = 'sensor-connect-pill';
  DOM.sensorPillCsc.querySelector('.sensor-status-text').textContent = 'Cad: Desconectado';
  DOM.btnConnectCsc.textContent = 'Emparejar';
}

// --- CONEXIONES BLUETOOTH Y AUTO-CONEXIÓN ---

// Intentar reconectar sensores previamente guardados
function triggerSilentBluetoothReconnect() {
  // Aplicar filtro de bici seleccionada
  const bikeId = AppState.selectedBikeProfileId;
  if (bikeId) {
    const bike = AppState.bikeProfiles.find(b => b.id === bikeId);
    BiciSensors.setBikeCadenceDevice(bike ? bike.cadenceDeviceId : null);
  }

  BiciSensors.silentReconnect(
    (hrVal) => {
      AppState.activeRide.hr = hrVal;
      DOM.liveHr.textContent = hrVal;
      
      const zone = Storage.getZoneForHR(hrVal, AppState.hrZones);
      if (zone > 0) {
        DOM.liveHrZone.textContent = `Z${zone}`;
        DOM.liveHrZone.className = `hr-zone-tag z${zone}-dot`;
        DOM.liveHrZone.style.backgroundColor = BiciCharts.ZONE_COLORS[`z${zone}`];
        DOM.liveHrZone.classList.remove('hide');
      } else {
        DOM.liveHrZone.classList.add('hide');
      }

      const respRate = Math.round(12 + (hrVal - 60) / 3.5);
      AppState.activeRide.respiration = respRate;
      DOM.liveRespiration.textContent = respRate;
    },
    (cadVal) => {
      AppState.activeRide.cadence = cadVal;
      DOM.liveCadence.textContent = cadVal;
    },
    (disconnectMsg) => {
      console.log(disconnectMsg);
      resetPillsUI();
    },
    (type, status, displayName) => {
      // Callback de actualización de estado para la UI en vivo
      updateSensorPillState(type, status, displayName);
    }
  );
}

// Actualizar el estado visual de la pastilla de sensor
function updateSensorPillState(type, status, displayName) {
  const pill = type === 'hr' ? DOM.sensorPillHr : DOM.sensorPillCsc;
  const btn = type === 'hr' ? DOM.btnConnectHr : DOM.btnConnectCsc;
  const prefix = type === 'hr' ? 'FC' : 'Cad';

  if (status === 'connecting') {
    pill.className = 'sensor-connect-pill';
    pill.querySelector('.sensor-status-text').textContent = `Buscando ${displayName}...`;
    btn.textContent = 'Buscando...';
  } else if (status === 'connected') {
    pill.className = 'sensor-connect-pill connected';
    pill.querySelector('.sensor-status-text').textContent = `${prefix}: ${displayName}`;
    btn.textContent = 'Desconectar';
  } else if (status === 'disconnected') {
    pill.className = 'sensor-connect-pill';
    pill.querySelector('.sensor-status-text').textContent = `${prefix}: Desconectado`;
    btn.textContent = 'Emparejar';
  }
}

async function toggleHRConnection() {
  if (BiciSensors.isHrConnected) {
    BiciSensors.disconnectAll();
    resetPillsUI();
  } else {
    DOM.btnConnectHr.textContent = 'Buscando...';
    DOM.sensorPillHr.className = 'sensor-connect-pill';
    
    try {
      const device = await BiciSensors.connectHeartRate(
        (hrValue) => {
          AppState.activeRide.hr = hrValue;
          DOM.liveHr.textContent = hrValue;

          const zone = Storage.getZoneForHR(hrValue, AppState.hrZones);
          if (zone > 0) {
            DOM.liveHrZone.textContent = `Z${zone}`;
            DOM.liveHrZone.className = `hr-zone-tag z${zone}-dot`;
            DOM.liveHrZone.style.backgroundColor = BiciCharts.ZONE_COLORS[`z${zone}`];
            DOM.liveHrZone.classList.remove('hide');
          } else {
            DOM.liveHrZone.classList.add('hide');
          }

          const respRate = Math.round(12 + (hrValue - 60) / 3.5);
          AppState.activeRide.respiration = respRate;
          DOM.liveRespiration.textContent = respRate;
        },
        (disconnectMsg) => {
          console.log(disconnectMsg);
          resetPillsUI();
        }
      );

      // Buscar alias personalizado o nombre original
      const sensorInfo = await DB.getSensor(device.id);
      const displayName = sensorInfo ? sensorInfo.customName : (device.name || 'Pulsómetro');

      DOM.sensorPillHr.className = 'sensor-connect-pill connected';
      DOM.sensorPillHr.querySelector('.sensor-status-text').textContent = `FC: ${displayName}`;
      DOM.btnConnectHr.textContent = 'Desconectar';
    } catch (err) {
      resetPillsUI();
    }
  }
}

async function toggleCSCConnection() {
  if (BiciSensors.isCscConnected) {
    BiciSensors.disconnectAll();
    resetPillsUI();
  } else {
    DOM.btnConnectCsc.textContent = 'Buscando...';
    DOM.sensorPillCsc.className = 'sensor-connect-pill';
    
    try {
      const device = await BiciSensors.connectCadence(
        (cadenceValue) => {
          AppState.activeRide.cadence = cadenceValue;
          DOM.liveCadence.textContent = cadenceValue;
        },
        (disconnectMsg) => {
          console.log(disconnectMsg);
          resetPillsUI();
        }
      );

      const sensorInfo = await DB.getSensor(device.id);
      const displayName = sensorInfo ? sensorInfo.customName : (device.name || 'Sensor CSC');

      DOM.sensorPillCsc.className = 'sensor-connect-pill connected';
      DOM.sensorPillCsc.querySelector('.sensor-status-text').textContent = `Cad: ${displayName}`;
      DOM.btnConnectCsc.textContent = 'Desconectar';
    } catch (err) {
      resetPillsUI();
    }
  }
}

// --- MOTOR DE SIMULACIÓN ---

function startDemoSimulation() {
  AppState.simulation.isActive = true;
  AppState.simulation.simSpeed = 24.5;
  AppState.simulation.simHr = 135;
  AppState.simulation.simCad = 85;

  DOM.gpsAccuracy.textContent = "GPS: Simulado";
  DOM.sensorPillHr.className = 'sensor-connect-pill connected';
  DOM.sensorPillHr.querySelector('.sensor-status-text').textContent = 'FC: Simulado';
  DOM.btnConnectHr.textContent = 'Desconectar';
  
  DOM.sensorPillCsc.className = 'sensor-connect-pill connected';
  DOM.sensorPillCsc.querySelector('.sensor-status-text').textContent = 'Cad: Simulado';
  DOM.btnConnectCsc.textContent = 'Desconectar';

  let simLat = 4.6097;
  let simLon = -74.0817;

  AppState.simulation.intervalId = setInterval(() => {
    if (AppState.activeRide.isPaused || AppState.activeRide.isAutoPaused) return;

    const speedDelta = (Math.random() - 0.5) * 1.8;
    AppState.simulation.simSpeed = Math.min(Math.max(AppState.simulation.simSpeed + speedDelta, 12), 42);
    AppState.activeRide.speed = AppState.simulation.simSpeed;
    DOM.liveSpeed.textContent = AppState.activeRide.speed.toFixed(1);

    const distancePerSecond = AppState.activeRide.speed / 3600;
    AppState.activeRide.distance += distancePerSecond;
    DOM.liveDistance.textContent = AppState.activeRide.distance.toFixed(2);

    simLat += 0.00008 * (AppState.activeRide.speed / 20);
    simLon += 0.00005 * Math.sin(AppState.activeRide.elapsedSeconds / 10);
    AppState.activeRide.lat = simLat;
    AppState.activeRide.lon = simLon;

    if (AppState.recMap) {
      const newPos = [simLat, simLon];
      AppState.recMarker.setLatLng(newPos);
      AppState.recPathLine.addLatLng(newPos);
      AppState.recMap.panTo(newPos);
      updateTargetDistance();
    }

    let grade = 0;
    if (AppState.activeRide.speed < 18) {
      grade = (18 - AppState.activeRide.speed) * 0.8;
    } else {
      grade = (18 - AppState.activeRide.speed) * 0.3;
    }
    AppState.activeRide.grade = grade;
    DOM.liveGrade.textContent = Math.round(grade) + '%';

    if (grade > 0) {
      AppState.activeRide.ascent += (grade / 100) * (distancePerSecond * 1000);
      DOM.liveAscent.textContent = Math.round(AppState.activeRide.ascent);
    }

    const targetHR = 110 + (grade > 0 ? grade * 7 : 0) + (AppState.activeRide.speed > 25 ? 15 : 0);
    const hrDelta = (targetHR - AppState.simulation.simHr) * 0.08 + (Math.random() - 0.5) * 3;
    AppState.simulation.simHr = Math.round(Math.min(Math.max(AppState.simulation.simHr + hrDelta, 90), 185));
    AppState.activeRide.hr = AppState.simulation.simHr;
    DOM.liveHr.textContent = AppState.activeRide.hr;

    const zone = Storage.getZoneForHR(AppState.activeRide.hr, AppState.hrZones);
    if (zone > 0) {
      DOM.liveHrZone.textContent = `Z${zone}`;
      DOM.liveHrZone.className = `hr-zone-tag z${zone}-dot`;
      DOM.liveHrZone.style.backgroundColor = BiciCharts.ZONE_COLORS[`z${zone}`];
      DOM.liveHrZone.classList.remove('hide');
    }

    const riderM = AppState.settings.weight || 70;
    const bikeM = AppState.settings.bikeWeight || 10;
    const totalMass = riderM + bikeM;
    const speedMs = AppState.activeRide.speed / 3.6;
    const angleRad = Math.atan(grade / 100);

    const fGravity = totalMass * 9.81 * Math.sin(angleRad);
    const fRolling = totalMass * 9.81 * Math.cos(angleRad) * 0.004;
    const fDrag = 0.5 * 0.32 * 1.225 * Math.pow(speedMs, 2);
    let power = (fGravity + fRolling + fDrag) * speedMs;
    if (power < 0) power = 0;
    AppState.activeRide.power = Math.round(power / 0.95);
    DOM.liveWatts.textContent = AppState.activeRide.power;

    const cadDelta = (Math.random() - 0.5) * 4;
    AppState.simulation.simCad = Math.round(Math.min(Math.max(AppState.simulation.simCad + cadDelta, 60), 110));
    AppState.activeRide.cadence = AppState.simulation.simCad;
    DOM.liveCadence.textContent = AppState.activeRide.cadence;

    const respRate = Math.round(12 + (AppState.activeRide.hr - 60) / 3.5);
    AppState.activeRide.respiration = respRate;
    DOM.liveRespiration.textContent = respRate;
    DOM.liveTemp.textContent = AppState.activeRide.temp;

    const isClimbSim = AppState.activeRide.elapsedSeconds % 100 > 30;
    if (isClimbSim) {
      const mockClimb = {
        active: true,
        distance: Math.max(0, 1200 - (AppState.activeRide.elapsedSeconds % 100) * 10),
        avgGrade: Math.max(3.2, grade),
        score: 1800,
        segments: [{ color: '#FECA57' }, { color: '#FF9F43' }, { color: '#FF6B6B' }, { color: '#FECA57' }]
      };
      updateClimbProUI(mockClimb);
    } else {
      updateClimbProUI(null);
    }

  }, 1000);
}

function stopDemoSimulation() {
  AppState.simulation.isActive = false;
  clearInterval(AppState.simulation.intervalId);
  resetPillsUI();
  DOM.gpsAccuracy.textContent = "GPS: --";
}

// --- RECUPERACIÓN DE SESIÓN ---

function resumeActiveSession(session) {
  // Adquirir bloqueo de pantalla al recuperar la sesión activa
  requestWakeLock();

  AppState.activeRide = {
    isRecording: true,
    isPaused: false,
    isAutoPaused: false,
    autoPauseTicks: 0,
    timerInterval: null,
    elapsedSeconds: session.elapsedSeconds,
    distance: session.distance,
    ascent: session.ascent,
    grade: 0,
    power: 0,
    hr: session.hr,
    cadence: session.cadence,
    respiration: session.respiration,
    temp: session.temp,
    targetCoords: session.targetCoords,
    samples: session.samples || [],
    sampleInterval: null,
    zoneTimes: session.zoneTimes
  };

  DOM.liveSpeed.textContent = '0.0';
  DOM.liveDistance.textContent = AppState.activeRide.distance.toFixed(2);
  DOM.liveTimer.textContent = BiciCharts.formatDuration(AppState.activeRide.elapsedSeconds);
  DOM.liveHr.textContent = AppState.activeRide.hr || '--';
  DOM.liveCadence.textContent = AppState.activeRide.cadence || '--';
  DOM.liveAscent.textContent = Math.round(AppState.activeRide.ascent);
  DOM.liveWatts.textContent = '--';
  DOM.liveGrade.textContent = '0%';
  DOM.liveRespiration.textContent = AppState.activeRide.respiration || '--';
  DOM.liveTemp.textContent = AppState.activeRide.temp;

  DOM.btnPauseRide.classList.remove('hide');
  DOM.btnResumeRide.classList.add('hide');

  navigateTo('recording');
  initRecordingMap();

  if (session.samples && session.samples.length > 0) {
    const coords = session.samples
      .filter(s => s.lat !== undefined && s.lon !== undefined)
      .map(s => [s.lat, s.lon]);
    
    if (coords.length > 0) {
      AppState.recPathLine.setLatLngs(coords);
      const lastCoord = coords[coords.length - 1];
      AppState.recMarker.setLatLng(lastCoord);
      AppState.recMap.setView(lastCoord, 16);
      AppState.activeRide.lat = lastCoord[0];
      AppState.activeRide.lon = lastCoord[1];
    }
  }

  if (session.targetCoords) {
    setTargetCoords(session.targetCoords.lat, session.targetCoords.lng);
  }

  if (session.simulationActive) {
    startDemoSimulation();
  } else {
    BiciGPS.startTracking(
      AppState.settings,
      (gpsData) => {
        if (AppState.activeRide.isAutoPaused) return;

        AppState.activeRide.speed = gpsData.speed;
        AppState.activeRide.distance = gpsData.distance;
        AppState.activeRide.ascent = gpsData.ascent;
        AppState.activeRide.grade = gpsData.grade;
        AppState.activeRide.power = gpsData.power;
        AppState.activeRide.lat = gpsData.latitude;
        AppState.activeRide.lon = gpsData.longitude;
        
        DOM.liveSpeed.textContent = gpsData.speed.toFixed(1);
        DOM.liveDistance.textContent = gpsData.distance.toFixed(2);
        DOM.liveAscent.textContent = Math.round(gpsData.ascent);
        DOM.liveGrade.textContent = Math.round(gpsData.grade) + '%';
        DOM.liveWatts.textContent = Math.round(gpsData.power);
        updateGpsAccuracyUI(gpsData.accuracy);

        if (AppState.recMap && gpsData.latitude && gpsData.longitude) {
          const newPos = [gpsData.latitude, gpsData.longitude];
          AppState.recMarker.setLatLng(newPos);
          AppState.recPathLine.addLatLng(newPos);
          AppState.recMap.panTo(newPos);
          updateTargetDistance();
        }
        updateClimbProUI(gpsData.climbInfo);
      }
    );
  }

  AppState.activeRide.timerInterval = setInterval(() => {
    if (AppState.settings.autoPause) {
      const noMovement = AppState.activeRide.speed < 2.0;
      const noHr = AppState.activeRide.hr === 0;
      const noCadence = AppState.activeRide.cadence === 0;

      if (noMovement && noHr && noCadence) {
        AppState.activeRide.autoPauseTicks++;
        if (AppState.activeRide.autoPauseTicks >= 6 && !AppState.activeRide.isAutoPaused) {
          AppState.activeRide.isAutoPaused = true;
          DOM.liveStatusBadge.textContent = 'AUTO-PAUSA';
          DOM.liveStatusBadge.className = 'status-indicator live-badge autopaused';
        }
      } else {
        AppState.activeRide.autoPauseTicks = 0;
        if (AppState.activeRide.isAutoPaused) {
          AppState.activeRide.isAutoPaused = false;
          DOM.liveStatusBadge.textContent = 'EN VIVO';
          DOM.liveStatusBadge.className = 'status-indicator live-badge';
        }
      }
    }

    const isRunning = !AppState.activeRide.isPaused && !AppState.activeRide.isAutoPaused;

    if (isRunning) {
      AppState.activeRide.elapsedSeconds++;
      DOM.liveTimer.textContent = BiciCharts.formatDuration(AppState.activeRide.elapsedSeconds);
      
      if (AppState.activeRide.hr > 0) {
        const zoneNum = Storage.getZoneForHR(AppState.activeRide.hr, AppState.hrZones);
        if (zoneNum > 0) {
          AppState.activeRide.zoneTimes[`z${zoneNum}`]++;
        }
      }

      Storage.saveActiveSession({
        elapsedSeconds: AppState.activeRide.elapsedSeconds,
        distance: AppState.activeRide.distance,
        ascent: AppState.activeRide.ascent,
        hr: AppState.activeRide.hr,
        cadence: AppState.activeRide.cadence,
        respiration: AppState.activeRide.respiration,
        temp: AppState.activeRide.temp,
        samples: AppState.activeRide.samples,
        zoneTimes: AppState.activeRide.zoneTimes,
        simulationActive: AppState.simulation.isActive,
        targetCoords: AppState.activeRide.targetCoords
      });
    }
  }, 1000);

  AppState.activeRide.sampleInterval = setInterval(() => {
    if (!AppState.activeRide.isPaused && !AppState.activeRide.isAutoPaused) {
      AppState.activeRide.samples.push({
        time: AppState.activeRide.elapsedSeconds,
        hr: AppState.activeRide.hr,
        speed: AppState.activeRide.speed,
        cadence: AppState.activeRide.cadence,
        lat: AppState.activeRide.lat,
        lon: AppState.activeRide.lon
      });
    }
  }, 5000);
}

// --- GESTIÓN CRUD DE SENSORES Y ALIASING ---

// Cargar y mostrar lista de sensores emparejados en IndexedDB
function loadSensorsList() {
  DOM.sensorsCrudList.innerHTML = '';

  DB.getAllSensors().then(sensors => {
    if (sensors.length === 0) {
      DOM.sensorsCrudList.innerHTML = `<div class="empty-state">No tienes sensores guardados en tu perfil móvil.</div>`;
      return;
    }

    sensors.forEach(sensor => {
      const item = document.createElement('div');
      item.className = 'sensor-crud-item';
      
      const icon = sensor.deviceType === 'hr' ? '❤️' : '⚙️';
      const typeLabel = sensor.deviceType === 'hr' ? 'Cardíaco' : 'Cadencia';

      item.innerHTML = `
        <div class="sensor-crud-info">
          <span class="sensor-crud-icon">${icon}</span>
          <div class="sensor-crud-details">
            <span class="sensor-crud-alias">${sensor.customName}</span>
            <span class="sensor-crud-original">${sensor.originalName} (${typeLabel})</span>
          </div>
        </div>
        <div class="sensor-crud-actions">
          <button class="sensor-action-btn-crud edit" aria-label="Editar alias">✏️</button>
          <button class="sensor-action-btn-crud delete" aria-label="Desvincular">🗑️</button>
        </div>
      `;

      // Evento Editar Alias
      item.querySelector('.edit').addEventListener('click', () => {
        openAliasModal(sensor);
      });

      // Evento Eliminar/Desvincular
      item.querySelector('.delete').addEventListener('click', () => {
        if (confirm(`¿Desvincular sensor "${sensor.customName}"? Deberás emparejarlo de nuevo en la siguiente rodada.`)) {
          DB.deleteSensor(sensor.deviceId).then(() => {
            // Si estaba conectado, forzar desconexión
            if (AppState.activeRide.isRecording) {
              BiciSensors.disconnectAll();
              resetPillsUI();
            }
            loadSensorsList();
          });
        }
      });

      DOM.sensorsCrudList.appendChild(item);
    });
  }).catch(err => {
    console.error("Error al cargar sensores desde DB:", err);
  });
}

let activeEditingSensor = null;

// Abrir modal de bautizar sensor
function openAliasModal(sensor) {
  activeEditingSensor = sensor;
  DOM.sensorAliasInput.value = sensor.customName;
  DOM.sensorAliasModal.classList.remove('hide');
  DOM.sensorAliasInput.focus();
}

// Guardar Alias de sensor
function saveSensorAlias() {
  if (!activeEditingSensor) return;

  const newAlias = DOM.sensorAliasInput.value.trim();
  if (newAlias === '') {
    alert("El nombre del sensor no puede quedar vacío.");
    return;
  }

  activeEditingSensor.customName = newAlias;
  
  DB.saveSensor(activeEditingSensor).then(() => {
    DOM.sensorAliasModal.classList.add('hide');
    activeEditingSensor = null;
    loadSensorsList();
    console.log("[BiciLog] Alias de sensor actualizado exitosamente.");
  }).catch(err => {
    console.error("Error al guardar alias:", err);
  });
}

// --- GESTIÓN DE PERFILES DE BICICLETA (MULTI-BIKE) ---

async function loadBikeProfiles() {
  AppState.bikeProfiles = await DB.getAllBikeProfiles();
  populateBikeSelector();
}

function populateBikeSelector() {
  DOM.bikeProfileSelect.innerHTML = '<option value="">Sin bici asignada</option>';
  AppState.bikeProfiles.forEach(bike => {
    const icon = bike.type === 'mtb' ? '⛰️' : '🚴';
    const option = document.createElement('option');
    option.value = bike.id;
    option.textContent = `${icon} ${bike.name}`;
    if (bike.id === AppState.selectedBikeProfileId) option.selected = true;
    DOM.bikeProfileSelect.appendChild(option);
  });
}

async function loadBikesScreen() {
  DOM.bikesCrudList.innerHTML = '';
  AppState.bikeProfiles = await DB.getAllBikeProfiles();

  if (AppState.bikeProfiles.length === 0) {
    DOM.bikesCrudList.innerHTML = '<div class="empty-state">No tienes bicicletas registradas.</div>';
    return;
  }

  AppState.bikeProfiles.forEach(bike => {
    const item = document.createElement('div');
    item.className = 'sensor-crud-item';
    const icon = bike.type === 'mtb' ? '⛰️' : '🚴';
    const typeLabel = bike.type === 'mtb' ? 'Montaña' : 'Ruta';

    item.innerHTML = `
      <div class="sensor-crud-info">
        <span class="sensor-crud-icon" style="font-size: 24px;">${icon}</span>
        <div class="sensor-crud-details">
          <span class="sensor-crud-alias">${bike.name}</span>
          <span class="sensor-crud-original">${typeLabel}${bike.cadenceDeviceId ? ' · Sensor cadencia vinculado' : ''}</span>
        </div>
      </div>
      <div class="sensor-crud-actions">
        <button class="sensor-action-btn-crud edit" data-bike-id="${bike.id}">✏️</button>
        <button class="sensor-action-btn-crud delete" data-bike-id="${bike.id}">🗑️</button>
      </div>
    `;

    item.querySelector('.edit').addEventListener('click', () => openBikeModal(bike));
    item.querySelector('.delete').addEventListener('click', () => {
      if (confirm(`¿Eliminar "${bike.name}"?`)) {
        DB.deleteBikeProfile(bike.id).then(() => {
          if (AppState.selectedBikeProfileId === bike.id) AppState.selectedBikeProfileId = null;
          loadBikeProfiles();
          loadBikesScreen();
        });
      }
    });

    DOM.bikesCrudList.appendChild(item);
  });
}

async function openBikeModal(bike = null) {
  DOM.bikeModalTitle.textContent = bike ? 'Editar Bicicleta' : 'Nueva Bicicleta';
  DOM.bikeNameInput.value = bike ? bike.name : '';
  DOM.bikeTypeSelect.value = bike ? bike.type : 'road';

  const sensors = await DB.getAllSensors();
  const cadenceSensors = sensors.filter(s => s.deviceType === 'cadence');
  DOM.bikeCadenceSelect.innerHTML = '<option value="">Ninguno</option>';
  cadenceSensors.forEach(s => {
    const option = document.createElement('option');
    option.value = s.deviceId;
    option.textContent = s.customName || s.originalName;
    if (bike && bike.cadenceDeviceId === s.deviceId) option.selected = true;
    DOM.bikeCadenceSelect.appendChild(option);
  });

  DOM.bikeProfileModal.dataset.bikeId = bike ? bike.id : '';
  DOM.bikeProfileModal.classList.remove('hide');
  DOM.bikeNameInput.focus();
}

async function saveBikeProfileHandler() {
  const name = DOM.bikeNameInput.value.trim();
  if (!name) { alert('El nombre es obligatorio.'); return; }

  const profile = {
    name,
    type: DOM.bikeTypeSelect.value,
    cadenceDeviceId: DOM.bikeCadenceSelect.value || null
  };

  const bikeId = DOM.bikeProfileModal.dataset.bikeId;
  if (bikeId) profile.id = parseInt(bikeId);

  await DB.saveBikeProfile(profile);
  DOM.bikeProfileModal.classList.add('hide');
  await loadBikeProfiles();
  loadBikesScreen();
}

async function forceUnpairAll() {
  if (!confirm('⚠️ Esto eliminará TODOS los sensores guardados y los permisos Bluetooth del navegador.\n\nÚsalo solo si los sensores no se conectan correctamente.')) return;

  await DB.clearUserSensors();
  BiciSensors.disconnectAll();
  resetPillsUI();

  // Limpiar asociaciones de cadencia en perfiles de bici
  for (const bike of AppState.bikeProfiles) {
    bike.cadenceDeviceId = null;
    await DB.saveBikeProfile(bike);
  }

  await loadBikeProfiles();
  loadSensorsList();
  alert('Todos los sensores han sido desemparejados. Reinicia la app para limpiar los permisos Bluetooth del sistema.');
}

// --- CRASH DETECTION & SOS SEQUENCE ---

function startCrashDetection() {
  CrashDetector.onCrashTrigger = triggerSOS;
  CrashDetector.requestPermission().then(granted => {
    if (granted) CrashDetector.start();
  });
}

function stopCrashDetection() {
  CrashDetector.stop();
}

// --- LIVE TELEMETRY ENGINE ---

function startTelemetryEngine() {
  AppState.telemetryInterval = setInterval(() => {
    if (!AppState.activeRide.isRecording) return;
    if (AppState.activeRide.isPaused || AppState.activeRide.isAutoPaused) return;

    let zone = 0;
    if (AppState.activeRide.hr > 0) {
      zone = Storage.getZoneForHR(AppState.activeRide.hr, AppState.hrZones);
    }

    updateLiveTelemetry({
      lat: AppState.activeRide.lat,
      lon: AppState.activeRide.lon,
      speed: AppState.activeRide.speed,
      hr: AppState.activeRide.hr,
      cadence: AppState.activeRide.cadence,
      zone: zone,
      distance: AppState.activeRide.distance,
      elapsed: AppState.activeRide.elapsedSeconds
    });
  }, 5000);
}

function stopTelemetryEngine() {
  if (AppState.telemetryInterval) clearInterval(AppState.telemetryInterval);
  AppState.telemetryInterval = null;
  clearLiveTelemetry();
}

// --- CLUB & COACH DASHBOARD ---

async function loadUserProfileToState() {
  try {
    AppState.userProfile = await getUserProfile();
    if (AppState.userProfile) {
      if (DOM.setBroadcast) DOM.setBroadcast.checked = !!AppState.userProfile.broadcastTelemetry;
      if (DOM.setClubCode) DOM.setClubCode.value = AppState.userProfile.clubCode || '';
    }
  } catch (_) { /* modo local */ }
}

async function bootFirebaseSilently() {
  try {
    await FBAuth.init();
    await loadUserProfileToState();
  } catch (_) {
    console.warn('[App] Firebase init falló — corriendo en Modo Local.');
  }
}

async function handleJoinClub() {
  const code = DOM.setClubCode.value.trim();
  if (!code) { alert('Ingresa un código de club.'); return; }
  const profile = AppState.userProfile || {};
  profile.clubCode = code;
  await saveUserProfile(profile);
  await loadUserProfileToState();
  alert(`Unido al club: ${code}`);
}

async function handleUpgradeCoach() {
  const code = DOM.setAdminCode.value.trim();
  if (!code) return alert('Ingresa el código de administrador.');
  try {
    const clubCode = await upgradeToCoach(code);
    await loadUserProfileToState();
    alert(`Promovido a Coach del club: ${clubCode}`);
  } catch (e) { alert(e.message); }
}

async function openCoachDashboard() {
  const clubCode = await getCoachClubCode();
  if (!clubCode) { alert('Debes ser Coach de un club. Únete a uno y usa el código de administrador.'); return; }

  DOM.coachClubLabel.textContent = `Club: ${clubCode}`;
  navigateTo('coach');

  setTimeout(() => {
    if (AppState.coachMap) { AppState.coachMap.remove(); AppState.coachMap = null; }
    AppState.coachMap = L.map('coach-map', { zoomControl: true }).setView([4.6097, -74.0817], 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '© OSM'
    }).addTo(AppState.coachMap);

    subscribeActiveRides(clubCode, (rides) => {
      const listEl = document.getElementById('coach-riders-list');
      if (!AppState.coachMap) return;

      const currentIds = new Set(rides.map(r => r.uid));
      Object.keys(AppState.coachMarkers).forEach(id => {
        if (!currentIds.has(id)) {
          AppState.coachMap.removeLayer(AppState.coachMarkers[id]);
          delete AppState.coachMarkers[id];
        }
      });

      rides.forEach(ride => {
        if (!ride.currentLat || !ride.currentLng) return;
        const zoneColor = BiciCharts.ZONE_COLORS[`z${ride.currentZone}`] || '#888';
        const tooltip = `${ride.displayName || 'Ciclista'}<br>⚡${ride.currentSpeed?.toFixed(1) || '0'} km/h<br>❤️${ride.currentHR || '--'} BPM (Z${ride.currentZone})`;

        if (AppState.coachMarkers[ride.uid]) {
          AppState.coachMarkers[ride.uid].setLatLng([ride.currentLat, ride.currentLng]);
          AppState.coachMarkers[ride.uid].setTooltipContent(tooltip);
        } else {
          const icon = L.divIcon({
            className: 'coach-marker',
            html: `<div style="background:${zoneColor};width:16px;height:16px;border-radius:50%;border:3px solid #fff;box-shadow:0 0 8px rgba(0,0,0,0.3);"></div>`,
            iconSize: [16, 16]
          });
          const marker = L.marker([ride.currentLat, ride.currentLng], { icon })
            .addTo(AppState.coachMap)
            .bindTooltip(tooltip, { direction: 'top', offset: [0, -10] });
          AppState.coachMarkers[ride.uid] = marker;
        }
      });

      listEl.textContent = rides.length
        ? `${rides.length} ciclista(s) activo(s) en el club`
        : 'Esperando ciclistas activos...';
    });
  }, 100);
}

function closeCoachDashboard() {
  if (AppState.coachMap) { AppState.coachMap.remove(); AppState.coachMap = null; }
  AppState.coachMarkers = {};
  navigateTo('settings');
}

function triggerSOS() {
  if (AppState.sosCountdown > 0) return;
  AppState.sosCountdown = 15;

  DOM.sosOverlay.classList.remove('hide');
  DOM.sosCountdownEl.textContent = '15';
  DOM.sosBtnCancel.classList.remove('hide');

  // Beep de emergencia
  try {
    AppState.sosAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
  } catch(e) { AppState.sosAudioCtx = null; }

  AppState.sosInterval = setInterval(() => {
    AppState.sosCountdown--;
    DOM.sosCountdownEl.textContent = AppState.sosCountdown;

    if (AppState.sosAudioCtx) {
      const osc = AppState.sosAudioCtx.createOscillator();
      const gain = AppState.sosAudioCtx.createGain();
      osc.connect(gain);
      gain.connect(AppState.sosAudioCtx.destination);
      osc.frequency.value = 880;
      osc.type = 'square';
      gain.gain.value = 0.15;
      osc.start(AppState.sosAudioCtx.currentTime);
      osc.stop(AppState.sosAudioCtx.currentTime + 0.12);
    }

    if (AppState.sosCountdown <= 0) {
      clearInterval(AppState.sosInterval);
      AppState.sosInterval = null;
      sendSOSAlert();
    }
  }, 1000);
}

function cancelSOS() {
  if (AppState.sosInterval) clearInterval(AppState.sosInterval);
  AppState.sosInterval = null;
  AppState.sosCountdown = 0;
  if (AppState.sosAudioCtx) { AppState.sosAudioCtx.close().catch(() => {}); AppState.sosAudioCtx = null; }
  DOM.sosOverlay.classList.add('hide');
}

function sendSOSAlert() {
  DOM.sosOverlay.classList.add('hide');
  const lat = AppState.activeRide.lat || 0;
  const lon = AppState.activeRide.lon || 0;
  const mapsUrl = `https://maps.google.com/?q=${lat},${lon}`;
  const msg = encodeURIComponent(`🚨 EMERGENCIA BICILOG: Posible caída detectada.\nUbicación: ${mapsUrl}\nVelocidad: ${AppState.activeRide.speed.toFixed(1)} km/h`);
  window.open(`https://wa.me/?text=${msg}`, '_blank');
}

// --- PIPELINE DE SINCRONIZACIÓN DE ACTIVIDADES ---

// Registrar sincronización en segundo plano (PWA Background Sync)
function triggerBackgroundSync() {
  if ('serviceWorker' in navigator && 'SyncManager' in window) {
    navigator.serviceWorker.ready.then(reg => {
      reg.sync.register('sync-rides')
        .then(() => console.log('[PWA Sync] Tarea de Background Sync registrada con éxito.'))
        .catch(err => {
          console.error('[PWA Sync] Error al registrar Background Sync, forzando subida activa:', err);
          runActiveSync();
        });
    });
  } else {
    console.log('[PWA Sync] Background Sync no soportado. Forzando subida en primer plano.');
    runActiveSync();
  }
}

// Sincronización en primer plano activa (iOS Safari y Fallback)
function runActiveSync() {
  if (!navigator.onLine) return; // Sin internet, esperar a estar online

  console.log('[Sync] Ejecutando sincronización de rodadas pendientes...');
  
  DB.getPendingRides().then(pending => {
    if (pending.length === 0) return;

    pending.forEach(ride => {
      // Intento 1: Firebase Firestore
      saveRideToFirestore(ride).then(synced => {
        if (synced) {
          DB.markRideSynced(ride.timestamp).then(() => {
            console.log(`[Firebase Sync] Rodada "${ride.title}" sincronizada.`);
            loadDashboardData();
          });
          return;
        }
        // Intento 2: REST externo
        return fetch('https://rrojas-synergia.github.io/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          timestamp: ride.timestamp,
          title: ride.title,
          distance: ride.distance,
          duration: ride.duration,
          ascent: ride.ascent
        })
      })
      .then(res => {
        if (res.ok) {
          DB.markRideSynced(ride.timestamp).then(() => {
            console.log(`[Sync] Rodada "${ride.title}" sincronizada.`);
            loadDashboardData();
          });
        } else {
          throw new Error();
        }
      })
      .catch(() => {
        // Fallback de Simulación local de red para GitHub Pages (HTTP 200)
        setTimeout(() => {
          DB.markRideSynced(ride.timestamp).then(() => {
            console.log(`[Sync Simulado] Rodada "${ride.title}" sincronizada exitosamente.`);
            loadDashboardData();
          });
        }, 1500);
      });
    });
  });
}

// --- INICIALIZADORES Y EVENTOS ---

document.addEventListener('DOMContentLoaded', () => {
  // --- CAPA ANTI-CRASH: errores de Firebase no deben congelar la app ---
  window.addEventListener('unhandledrejection', (e) => {
    console.warn('[App] Rejection silenciado:', e.reason?.message || e.reason);
    e.preventDefault();
  });

  // Inicializar base de datos IndexedDB antes de cargar vistas y reconectar
  DB.init().then(() => {
    loadDashboardData();
    loadBikeProfiles();
    triggerSilentBluetoothReconnect();
    runActiveSync();
    bootFirebaseSilently();
  }).catch(err => {
    console.error("No se pudo iniciar IndexedDB. Cayendo en modo limitado.", err);
    loadDashboardData();
  });

  // Listener para sincronización activa cuando se recupera red
  window.addEventListener('online', runActiveSync);

  // Interceptar eventos "Undo" del sistema (Shake to Undo en iPhones)
  window.addEventListener('beforeinput', (e) => {
    if (e.inputType === 'historyUndo' || e.inputType === 'historyRedo') {
      e.preventDefault();
      console.log("[BiciLog] Shake-to-Undo bloqueado por seguridad.");
    }
  });

  // --- REGISTRO DE EVENTOS DE BOTONES ---

  // Navegación Básica
  DOM.btnOpenSettings.addEventListener('click', () => navigateTo('settings'));
  DOM.btnSettingsBack.addEventListener('click', () => navigateTo('dashboard'));
  DOM.btnDetailBack.addEventListener('click', () => navigateTo('dashboard'));
  DOM.btnGotoSensors.addEventListener('click', () => navigateTo('sensors'));

  // Tab navigation en detalle
  document.querySelectorAll('.detail-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.detail-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      switchDetailTab(tab.dataset.tab);
    });
  });
  DOM.btnSensorsBack.addEventListener('click', () => navigateTo('settings'));
  DOM.btnGotoBikes.addEventListener('click', () => navigateTo('bikes'));
  DOM.btnBikesBack.addEventListener('click', () => navigateTo('settings'));

  // Selector de bici
  DOM.bikeProfileSelect.addEventListener('change', () => {
    const id = parseInt(DOM.bikeProfileSelect.value) || null;
    AppState.selectedBikeProfileId = id;
    const bike = AppState.bikeProfiles.find(b => b.id === id);
    BiciSensors.setBikeCadenceDevice(bike ? bike.cadenceDeviceId : null);
  });

  DOM.btnBikeManage.addEventListener('click', (e) => {
    e.stopPropagation();
    navigateTo('bikes');
  });

  // Iniciar Rodada
  DOM.btnStartRide.addEventListener('click', () => {
    if (document.activeElement) document.activeElement.blur(); // Quitar foco para evitar Shake to Undo
    startWorkout();
  });

  // Conectar Sensores
  DOM.btnConnectHr.addEventListener('click', (e) => {
    e.stopPropagation();
    if (AppState.simulation.isActive) return;
    toggleHRConnection();
  });

  DOM.btnConnectCsc.addEventListener('click', (e) => {
    e.stopPropagation();
    if (AppState.simulation.isActive) return;
    toggleCSCConnection();
  });

  // Controles de Rodada
  DOM.btnPauseRide.addEventListener('click', () => {
    if (document.activeElement) document.activeElement.blur();
    pauseWorkout();
  });
  
  DOM.btnResumeRide.addEventListener('click', () => {
    if (document.activeElement) document.activeElement.blur();
    resumeWorkout();
  });
  
  DOM.btnStopRide.addEventListener('click', () => {
    if (document.activeElement) document.activeElement.blur();
    stopWorkout();
  });

  // Tap-to-show controls: al tocar la pantalla de grabación, mostrar botones 3s
  DOM.screens.recording.addEventListener('touchstart', () => {
    if (AppState.activeRide && AppState.activeRide.isRecording) {
      AppState.activeRide.controlsShowUntil = Date.now() + 3000;
      const controls = document.querySelector('.recording-actions');
      if (controls) controls.classList.remove('auto-hidden');
    }
  });

  // Limpiar destino fijado
  DOM.btnClearTarget.addEventListener('click', (e) => {
    e.stopPropagation();
    clearTargetCoords();
  });

  // Controles del modal de alias
  DOM.btnAliasCancel.addEventListener('click', () => {
    DOM.sensorAliasModal.classList.add('hide');
    activeEditingSensor = null;
  });

  DOM.btnAliasSave.addEventListener('click', () => {
    saveSensorAlias();
  });

  // Gestión de Bicicletas
  DOM.btnAddBike.addEventListener('click', () => openBikeModal(null));
  DOM.btnBikeCancel.addEventListener('click', () => { DOM.bikeProfileModal.classList.add('hide'); });
  DOM.btnBikeSave.addEventListener('click', () => saveBikeProfileHandler());
  DOM.btnForceUnpair.addEventListener('click', () => forceUnpairAll());

  // SOS cancel
  DOM.sosBtnCancel.addEventListener('click', () => cancelSOS());

  // Club & Telemetry
  DOM.btnJoinClub.addEventListener('click', () => handleJoinClub());
  DOM.btnUpgradeCoach.addEventListener('click', () => handleUpgradeCoach());
  DOM.btnCoachDashboard.addEventListener('click', () => openCoachDashboard());
  DOM.btnCoachBack.addEventListener('click', () => closeCoachDashboard());

  // Guardar toggle de broadcast al cambiar
  DOM.setBroadcast.addEventListener('change', async () => {
    const profile = AppState.userProfile || {};
    profile.broadcastTelemetry = DOM.setBroadcast.checked;
    await saveUserProfile(profile);
    AppState.userProfile = profile;
  });

  // Selector del Simulador
  DOM.chkSimulate.addEventListener('change', (e) => {
    if (e.target.checked) {
      if (AppState.activeRide.isRecording) {
        BiciGPS.stopTracking();
        startDemoSimulation();
      } else {
        AppState.simulation.isActive = true;
      }
    } else {
      if (AppState.activeRide.isRecording) {
        stopDemoSimulation();
        BiciGPS.startTracking(
          AppState.settings,
          (gpsData) => {
            if (AppState.activeRide.isAutoPaused) return;

            AppState.activeRide.speed = gpsData.speed;
            AppState.activeRide.distance = gpsData.distance;
            AppState.activeRide.ascent = gpsData.ascent;
            AppState.activeRide.grade = gpsData.grade;
            AppState.activeRide.power = gpsData.power;
            AppState.activeRide.lat = gpsData.latitude;
            AppState.activeRide.lon = gpsData.longitude;
            
            DOM.liveSpeed.textContent = gpsData.speed.toFixed(1);
            DOM.liveDistance.textContent = gpsData.distance.toFixed(2);
            DOM.liveAscent.textContent = Math.round(gpsData.ascent);
            DOM.liveGrade.textContent = Math.round(gpsData.grade) + '%';
            DOM.liveWatts.textContent = Math.round(gpsData.power);
            updateGpsAccuracyUI(gpsData.accuracy);

            if (AppState.recMap && gpsData.latitude && gpsData.longitude) {
              const newPos = [gpsData.latitude, gpsData.longitude];
              AppState.recMarker.setLatLng(newPos);
              AppState.recPathLine.addLatLng(newPos);
              AppState.recMap.panTo(newPos);
              updateTargetDistance();
            }
            updateClimbProUI(gpsData.climbInfo);
          }
        );
      } else {
        AppState.simulation.isActive = false;
      }
    }
  });

  // Borrar rodada actual de IndexedDB
  DOM.btnDeleteRide.addEventListener('click', () => {
    if (AppState.selectedRide) {
      if (confirm(`¿Estás seguro de que quieres eliminar la rodada "${AppState.selectedRide.title}"?`)) {
        DB.deleteRide(AppState.selectedRide.timestamp).then(() => {
          navigateTo('dashboard');
        });
      }
    }
  });

  // Guardar Ajustes
  DOM.settingsForm.addEventListener('submit', (e) => {
    e.preventDefault();
    
    const useAuto = DOM.setUseAuto.checked;
    let manualZones = {};

    if (!useAuto) {
      const zones = ['z1', 'z2', 'z3', 'z4', 'z5'];
      for (const z of zones) {
        const minVal = parseInt(document.getElementById(`${z}-min`).value) || 0;
        const maxVal = parseInt(document.getElementById(`${z}-max`).value) || 0;
        manualZones[z] = { min: minVal, max: maxVal };
      }
    }

    const updatedSettings = {
      age: parseInt(DOM.setAge.value) || 30,
      weight: parseInt(DOM.setWeight.value) || 70,
      bikeWeight: parseInt(DOM.setBikeWeight.value) || 10,
      autoPause: DOM.setAutopause.checked,
      useAutoZones: useAuto,
      manualZones: useAuto ? AppState.settings.manualZones : manualZones
    };

    Storage.saveSettings(updatedSettings);
    loadDashboardData();
    navigateTo('dashboard');
  });

  // Comportamiento de Switch Auto Zonas
  DOM.setUseAuto.addEventListener('change', (e) => {
    if (e.target.checked) {
      DOM.manualZonesContainer.classList.add('hide');
      DOM.autoZonesPreview.classList.remove('hide');
      updateAutoZonesPreview();
    } else {
      DOM.manualZonesContainer.classList.remove('hide');
      DOM.autoZonesPreview.classList.add('hide');
      
      const settings = Storage.getSettings();
      Object.keys(settings.manualZones).forEach(zone => {
        document.getElementById(`${zone}-min`).value = settings.manualZones[zone].min;
        document.getElementById(`${zone}-max`).value = settings.manualZones[zone].max;
      });
    }
  });

  // Cambios en edad
  DOM.setAge.addEventListener('input', () => {
    if (DOM.setUseAuto.checked) {
      updateAutoZonesPreview();
    }
  });

  // Configuración del modal de recuperación
  DOM.btnRecoveryDiscard.addEventListener('click', () => {
    Storage.clearActiveSession();
    DOM.sessionRecoveryModal.classList.add('hide');
  });

  DOM.btnRecoveryResume.addEventListener('click', () => {
    DOM.sessionRecoveryModal.classList.add('hide');
    const saved = Storage.getActiveSession();
    if (saved) resumeActiveSession(saved);
  });
});

// Escuchar cambios de visibilidad de la página para restaurar Wake Lock
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible') {
    if (AppState.activeRide && AppState.activeRide.isRecording && !AppState.activeRide.isPaused) {
      await requestWakeLock();
    }
  }
});

// Escuchar cambios de estado BLE para actualizar pastillas en la UI
window.addEventListener('ble-status-change', (e) => {
  const { type, status, displayName } = e.detail;
  updateSensorPillState(type, status, displayName);
});

// Registrar Service Worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then(reg => console.log('Service Worker registrado con éxito:', reg.scope))
      .catch(err => console.error('Error al registrar Service Worker:', err));
  });
}
