// charts.js - Generador de gráficos SVG para BiciLog

export const BiciCharts = {
  // Colores deportivos estándar para las zonas de FC
  ZONE_COLORS: {
    z1: '#00D2D3', // Celeste/Recuperación
    z2: '#1DD1A1', // Verde/Resistencia
    z3: '#FECA57', // Amarillo/Tempo
    z4: '#FF9F43', // Naranja/Umbral
    z5: '#FF6B6B'  // Rojo/Anaeróbico
  },

  // Generar la visualización de Zonas de FC (Barras Horizontales con Flexbox)
  renderHRZones(containerId, zoneTimes, totalTime) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = ''; // Limpiar contenedor
    
    const zones = ['z1', 'z2', 'z3', 'z4', 'z5'];
    const zoneNames = {
      z1: 'Z1 Recuperación',
      z2: 'Z2 Resistencia',
      z3: 'Z3 Tempo',
      z4: 'Z4 Umbral',
      z5: 'Z5 Anaeróbico'
    };

    zones.forEach(zone => {
      const seconds = zoneTimes[zone] || 0;
      const percentage = totalTime > 0 ? Math.round((seconds / totalTime) * 100) : 0;
      const formattedTime = this.formatDuration(seconds);

      const zoneRow = document.createElement('div');
      zoneRow.className = 'zone-chart-row';
      zoneRow.style.display = 'flex';
      zoneRow.style.flexDirection = 'column';
      zoneRow.style.marginBottom = '12px';

      zoneRow.innerHTML = `
        <div class="zone-labels" style="display: flex; justify-content: space-between; font-size: 13px; font-weight: 600; margin-bottom: 4px; color: #57606F;">
          <span>${zoneNames[zone]}</span>
          <span>${formattedTime} (${percentage}%)</span>
        </div>
        <div class="zone-bar-bg" style="background: #EAEFF2; height: 12px; border-radius: 6px; overflow: hidden; width: 100%;">
          <div class="zone-bar-fill" style="background: ${this.ZONE_COLORS[zone]}; width: ${percentage}%; height: 100%; border-radius: 6px; transition: width 0.8s ease-out;"></div>
        </div>
      `;
      container.appendChild(zoneRow);
    });
  },

  // Generar un gráfico de línea SVG para el perfil de esfuerzo (Frecuencia Cardíaca y Velocidad)
  renderRideProfile(containerId, dataPoints) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = ''; // Limpiar

    if (!dataPoints || dataPoints.length < 2) {
      container.innerHTML = `<div style="text-align: center; color: #A4B0BE; padding: 20px; font-size: 14px;">No hay suficientes datos de sensores para graficar el perfil de la rodada.</div>`;
      return;
    }

    const width = container.clientWidth || 300;
    const height = 150;
    const padding = 15;

    // Encontrar máximos y mínimos para escalar
    const hrs = dataPoints.map(p => p.hr || 0);
    const speeds = dataPoints.map(p => p.speed || 0);

    const maxHR = Math.max(...hrs, 100);
    const minHR = Math.min(...hrs.filter(h => h > 0), 60);
    const maxSpeed = Math.max(...speeds, 10);

    // Dibujar SVG
    let svgContent = `
      <svg width="100%" height="${height}" viewBox="0 0 ${width} ${height}" style="overflow: visible;">
        <defs>
          <linearGradient id="hr-gradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#FF6B6B" stop-opacity="0.4"/>
            <stop offset="100%" stop-color="#FF6B6B" stop-opacity="0.0"/>
          </linearGradient>
          <linearGradient id="speed-gradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#0080FF" stop-opacity="0.3"/>
            <stop offset="100%" stop-color="#0080FF" stop-opacity="0.0"/>
          </linearGradient>
        </defs>
    `;

    // Generar puntos para el trazo
    const pointsCount = dataPoints.length;
    const stepX = (width - padding * 2) / (pointsCount - 1);

    let hrPathPoints = [];
    let speedPathPoints = [];

    dataPoints.forEach((point, index) => {
      const x = padding + index * stepX;
      
      // Escalar HR (rango de minHR a maxHR)
      const hrRange = maxHR - minHR || 1;
      const yHR = height - padding - ((point.hr - minHR) / hrRange) * (height - padding * 2);

      // Escalar Velocidad (rango de 0 a maxSpeed)
      const ySpeed = height - padding - (point.speed / (maxSpeed || 1)) * (height - padding * 2);

      hrPathPoints.push(`${x},${yHR}`);
      speedPathPoints.push(`${x},${ySpeed}`);
    });

    // Dibujar Área y Línea de Frecuencia Cardíaca (Rojo)
    const hrPathD = `M ${hrPathPoints.join(' L ')}`;
    const hrAreaD = `${hrPathD} L ${padding + (pointsCount - 1) * stepX},${height - padding} L ${padding},${height - padding} Z`;

    svgContent += `
      <path d="${hrAreaD}" fill="url(#hr-gradient)" />
      <path d="${hrPathD}" fill="none" stroke="#FF6B6B" stroke-width="2.5" stroke-linecap="round" />
    `;

    // Dibujar línea de Velocidad (Azul)
    const speedPathD = `M ${speedPathPoints.join(' L ')}`;
    svgContent += `
      <path d="${speedPathD}" fill="none" stroke="#0080FF" stroke-width="1.5" stroke-dasharray="3,3" stroke-linecap="round" />
    `;

    // Líneas de Ejes / Límites
    svgContent += `
      <line x1="${padding}" y1="${height - padding}" x2="${width - padding}" y2="${height - padding}" stroke="#E4E7EB" stroke-width="1" />
      <text x="${padding}" y="${height - 2}" fill="#A4B0BE" font-size="9" font-weight="600">0:00</text>
      <text x="${width - padding - 25}" y="${height - 2}" fill="#A4B0BE" font-size="9" font-weight="600">Fin</text>
      <text x="${padding}" y="${padding - 2}" fill="#FF6B6B" font-size="9" font-weight="600">FC Máx: ${Math.round(maxHR)}</text>
      <text x="${width - padding - 65}" y="${padding - 2}" fill="#0080FF" font-size="9" font-weight="600">Vel Máx: ${maxSpeed.toFixed(1)} km/h</text>
    `;

    svgContent += `</svg>`;
    container.innerHTML = svgContent;
  },

  // Generar gráfico de resumen semanal (barras SVG)
  renderWeeklySummary(containerId, weeklyRides) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = '';

    const width = container.clientWidth || 300;
    const height = 120;
    const padding = 20;

    // Obtener los últimos 7 días
    const days = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    const today = new Date();
    const last7Days = [];
    
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      last7Days.push({
        dayName: days[d.getDay()],
        dateStr: d.toDateString(),
        distance: 0
      });
    }

    // Sumar distancias de rodadas en cada día
    weeklyRides.forEach(ride => {
      const rideDate = new Date(ride.timestamp).toDateString();
      const match = last7Days.find(d => d.dateStr === rideDate);
      if (match) {
        match.distance += ride.distance || 0;
      }
    });

    const maxDistance = Math.max(...last7Days.map(d => d.distance), 10);
    const stepX = (width - padding * 2) / 7;
    const chartHeight = height - padding * 2;

    let svgContent = `<svg width="100%" height="${height}" viewBox="0 0 ${width} ${height}">`;

    last7Days.forEach((day, index) => {
      const x = padding + index * stepX + (stepX - 16) / 2; // centrar barra
      const barHeight = (day.distance / maxDistance) * chartHeight;
      const y = height - padding - barHeight;

      // Dibujar barra con bordes redondeados arriba
      svgContent += `
        <rect x="${x}" y="${y}" width="16" height="${barHeight}" rx="4" ry="4" fill="${day.distance > 0 ? '#0080FF' : '#E4E7EB'}" />
      `;

      // Texto de distancia encima de la barra
      if (day.distance > 0) {
        svgContent += `
          <text x="${x + 8}" y="${y - 4}" text-anchor="middle" fill="#2F3542" font-size="8" font-weight="700">${Math.round(day.distance)}k</text>
        `;
      }

      // Nombre del día
      svgContent += `
        <text x="${x + 8}" y="${height - 4}" text-anchor="middle" fill="#747D8C" font-size="9" font-weight="600">${day.dayName}</text>
      `;
    });

    svgContent += `</svg>`;
    container.innerHTML = svgContent;
  },

  // Formatear segundos en formato HH:MM:SS o MM:SS
  formatDuration(totalSeconds) {
    const hrs = Math.floor(totalSeconds / 3600);
    const mins = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;
    
    const parts = [];
    if (hrs > 0) {
      parts.push(hrs.toString().padStart(2, '0'));
    }
    parts.push(mins.toString().padStart(2, '0'));
    parts.push(secs.toString().padStart(2, '0'));
    
    return parts.join(':');
  }
};
