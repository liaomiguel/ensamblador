const socket = io();
const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
const miniCanvas = document.getElementById('minimap-canvas');
const mCtx = miniCanvas.getContext('2d');

const menuOverlay = document.getElementById('menu-overlay');
const deathBanner = document.getElementById('death-banner');
const continueButton = document.getElementById('continue-button');
const playButton = document.getElementById('play-button');
const nicknameInput = document.getElementById('nickname');

function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    miniCanvas.width = 150;
    miniCanvas.height = 150;
}
window.addEventListener('resize', resize);
resize();

let players = [];
let modules = [];
let myProjectiles = [];
let satellites = [];
let myId = null;
let camera = { x: 0, y: 0, shake: 0 };
const mapSize = 3000;

const moduleColors = {
    core: '#fff',
    thruster: '#00f2ff',
    cannon: '#ff0055',
    shield: '#bf00ff',
    drill: '#ffff00'
};

let particles = [];
function createParticles(x, y, color, count = 5, speed = 2, life = 20) {
    for (let i = 0; i < count; i++) {
        particles.push({
            x, y,
            vx: (Math.random() - 0.5) * speed,
            vy: (Math.random() - 0.5) * speed,
            color,
            life,
            maxLife: life
        });
    }
}

const inputs = { up: false, left: false, right: false, down: false, shoot: false, boost: false, brake: false, rotate: false, drop: false };

window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (['w', 'arrowup'].includes(k)) inputs.up = true;
    if (['a', 'arrowleft'].includes(k)) inputs.left = true;
    if (['d', 'arrowright'].includes(k)) inputs.right = true;
    if (['s', 'arrowdown'].includes(k)) inputs.down = true;
    if (e.key === ' ') inputs.shoot = true;
    if (e.key === 'Shift') inputs.boost = true;
    if (k === 'e') inputs.brake = true;
    if (k === 'r') inputs.rotate = true;
    if (k === 'q') inputs.drop = true;
    socket.emit('input', inputs);
});

window.addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase();
    if (['w', 'arrowup'].includes(k)) inputs.up = false;
    if (['a', 'arrowleft'].includes(k)) inputs.left = false;
    if (['d', 'arrowright'].includes(k)) inputs.right = false;
    if (['s', 'arrowdown'].includes(k)) inputs.down = false;
    if (e.key === ' ') inputs.shoot = false;
    if (e.key === 'Shift') inputs.boost = false;
    if (k === 'e') inputs.brake = false;
    if (k === 'r') inputs.rotate = false;
    if (k === 'q') inputs.drop = false;
    socket.emit('input', inputs);
});

socket.on('connect', () => { myId = socket.id; });

let targetState = { players: [], modules: [], projectiles: [], satellites: [], movingSatellites: [] };
let currentState = { players: [], modules: [], projectiles: [], satellites: [], movingSatellites: [] };

socket.on('s', (state) => {
    // Descomprimir el estado recibido
    targetState.players = (state.p || []).map(p => ({
        id: p.i,
        nickname: p.n,
        position: p.pos,
        angle: p.a,
        modules: p.m,
        boostActive: p.b,
        isBraking: p.br
    }));
    targetState.modules = (state.m || []).map(m => ({ position: {x: m.x, y: m.y}, type: m.t }));
    targetState.projectiles = (state.pr || []).map(p => ({ position: {x: p.x, y: p.y} }));
    targetState.satellites = (state.sa || []).map(s => ({ position: {x: s.x, y: s.y}, angle: s.a }));
    targetState.movingSatellites = (state.ms || []).map(s => ({ position: {x: s.x, y: s.y}, angle: s.a }));
    
    // Si currentState está vacío, inicializarlo inmediatamente con el primer paquete
    if (currentState.players.length === 0 && targetState.players.length > 0) {
        currentState = JSON.parse(JSON.stringify(targetState));
    }
    
    const me = targetState.players.find(p => p.id === myId);
    if (me) {
        document.getElementById('module-count').innerText = `Modules: ${me.modules.length}`;
    }
    updateLeaderboard();
});

// Función LERP para interpolación lineal
function lerp(start, end, t) {
    if (isNaN(start)) return end;
    return start + (end - start) * t;
}

function updateInterpolation() {
    const t = 0.2; // Aumentamos un poco el factor para que sea más responsivo
    
    targetState.players.forEach(tp => {
        let cp = currentState.players.find(p => p.id === tp.id);
        if (!cp) {
            // Jugador nuevo: clonar inmediatamente
            currentState.players.push(JSON.parse(JSON.stringify(tp)));
        } else {
            // Interpolar posición
            cp.position.x = lerp(cp.position.x, tp.position.x, t);
            cp.position.y = lerp(cp.position.y, tp.position.y, t);
            
            // Suavizado de ángulo
            let diff = tp.angle - cp.angle;
            while (diff < -Math.PI) diff += Math.PI * 2;
            while (diff > Math.PI) diff -= Math.PI * 2;
            cp.angle += diff * t;
            
            // Copiar estados booleanos y arrays directamente
            cp.modules = tp.modules;
            cp.boostActive = tp.boostActive;
            cp.isBraking = tp.isBraking;
            cp.nickname = tp.nickname;
        }
    });
    
    // Eliminar jugadores que ya no están
    if (currentState.players.length !== targetState.players.length) {
        currentState.players = currentState.players.filter(cp => targetState.players.some(tp => tp.id === cp.id));
    }
    
    // Cámara sigue al jugador suavemente (usar targetState para evitar lag de cámara si se desea, pero currentState es más suave)
    const me = currentState.players.find(p => p.id === myId);
    if (me) {
        camera.x = me.position.x;
        camera.y = me.position.y;
    }

    // Interpolación de satélites
    targetState.satellites.forEach((ts, i) => {
        if (!currentState.satellites[i]) {
            currentState.satellites[i] = JSON.parse(JSON.stringify(ts));
        } else {
            currentState.satellites[i].position.x = lerp(currentState.satellites[i].position.x, ts.position.x, t);
            currentState.satellites[i].position.y = lerp(currentState.satellites[i].position.y, ts.position.y, t);
            currentState.satellites[i].angle = lerp(currentState.satellites[i].angle, ts.angle, t);
        }
    });

    // Interpolación de satélites móviles
    targetState.movingSatellites.forEach((ts, i) => {
        if (!currentState.movingSatellites[i]) {
            currentState.movingSatellites[i] = JSON.parse(JSON.stringify(ts));
        } else {
            currentState.movingSatellites[i].position.x = lerp(currentState.movingSatellites[i].position.x, ts.position.x, t);
            currentState.movingSatellites[i].position.y = lerp(currentState.movingSatellites[i].position.y, ts.position.y, t);
            currentState.movingSatellites[i].angle = lerp(currentState.movingSatellites[i].angle, ts.angle, t);
        }
    });
    
    currentState.modules = targetState.modules;
    currentState.projectiles = targetState.projectiles;
}

socket.on('gameover', (data) => {
    camera.shake = 40;
    createParticles(camera.x, camera.y, '#fff', 100, 15, 80);
    createParticles(camera.x, camera.y, '#00f2ff', 100, 20, 60);
    createParticles(camera.x, camera.y, '#ff0055', 60, 10, 40);
    
    setTimeout(() => {
        deathBanner.style.display = 'flex';
        document.getElementById('death-report-reason').innerText = data.reason || 'SISTEMAS CRÍTICOS FALLIDOS';
    }, 1500);
});

continueButton.addEventListener('click', () => {
    deathBanner.style.display = 'none';
    menuOverlay.style.display = 'flex';
});

playButton.addEventListener('click', () => {
    socket.emit('join', nicknameInput.value.trim());
    menuOverlay.style.display = 'none';
});

function updateLeaderboard() {
    const list = document.getElementById('leaderboard-list');
    list.innerHTML = '';
    const sorted = [...targetState.players].sort((a, b) => b.modules.length - a.modules.length);
    sorted.slice(0, 5).forEach(p => {
        const li = document.createElement('li');
        li.innerHTML = `<span>${p.nickname || 'UNK_USER'}</span> <strong>${p.modules.length}</strong>`;
        if (p.id === myId) li.style.color = '#00f2ff';
        list.appendChild(li);
    });
}

function draw() {
    updateInterpolation();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    
    if (camera.shake > 0) {
        ctx.translate(Math.random() * camera.shake - camera.shake/2, Math.random() * camera.shake - camera.shake/2);
        camera.shake *= 0.9;
        if (camera.shake < 0.1) camera.shake = 0;
    }
    
    ctx.translate(canvas.width / 2 - camera.x, canvas.height / 2 - camera.y);
    
    drawBoundaries();
    drawGrid();
    drawSatellites();
    drawMovingSatellites();

    particles = particles.filter(p => {
        p.x += p.vx; p.y += p.vy; p.life--;
        ctx.globalAlpha = p.life / p.maxLife;
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x, p.y, 3, 3);
        return p.life > 0;
    });
    ctx.globalAlpha = 1;
    
    // Optimizamos el dibujo de módulos sueltos (sin sombras pesadas)
    ctx.lineWidth = 1;
    currentState.modules.forEach(m => {
        // Solo dibujar si está cerca de la pantalla (Culling simple)
        if (Math.abs(m.position.x - camera.x) < canvas.width && Math.abs(m.position.y - camera.y) < canvas.height) {
            ctx.strokeStyle = moduleColors[m.type] || '#fff';
            drawDiamond(ctx, m.position.x, m.position.y, 10);
        }
    });
    
    currentState.projectiles.forEach(p => {
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(p.position.x, p.position.y); ctx.lineTo(p.position.x - 12, p.position.y); ctx.stroke();
    });
    
    currentState.players.forEach(p => {
        ctx.save();
        ctx.translate(p.position.x, p.position.y);
        
        // Dibujo de nickname (solo si es necesario)
        const topModY = p.modules.length > 0 ? Math.min(...p.modules.map(m => m.y)) : 0;
        const nicknameOffset = topModY * 40 - 30; 
        ctx.fillStyle = p.id === myId ? '#00f2ff' : '#fff';
        ctx.font = '12px "Share Tech Mono"'; ctx.textAlign = 'center';
        ctx.fillText(`> ${p.nickname || 'UNK_USER'}`, 0, nicknameOffset);
        
        if (p.isBraking && Math.random() > 0.5) createParticles(p.position.x, p.position.y, '#ffaa00', 1, 4, 10);
        
        ctx.rotate(p.angle);
        
        // Optimizamos el dibujo de naves: eliminamos shadowBlur si hay muchos jugadores
        const useEffects = currentState.players.length < 5;
        if (useEffects) {
            ctx.shadowBlur = 10;
        }

        p.modules.forEach(mod => {
            const size = 36; const x = mod.x * 40; const y = mod.y * 40;
            ctx.strokeStyle = moduleColors[mod.type];
            if (useEffects) ctx.shadowColor = ctx.strokeStyle;
            
            ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
            ctx.lineWidth = 2; 
            ctx.strokeRect(x - size/2, y - size/2, size, size);
            ctx.fillRect(x - size/2, y - size/2, size, size);
            
            if (mod.type === 'core') { 
                ctx.fillStyle = '#fff';
                ctx.beginPath();
                ctx.moveTo(x + 12, y);
                ctx.lineTo(x - 10, y - 10);
                ctx.lineTo(x - 5, y);
                ctx.lineTo(x - 10, y + 10);
                ctx.closePath();
                ctx.fill();
            } else if (mod.type === 'thruster') {
                ctx.strokeStyle = p.boostActive ? '#ffffff' : '#00f2ff';
                ctx.beginPath(); ctx.moveTo(x-size/2, y-5); ctx.lineTo(x-size/2-(p.boostActive ? 45 : 18), y); ctx.lineTo(x-size/2, y+5); ctx.stroke();
                if (p.boostActive && Math.random() > 0.3) createParticles(p.position.x + x - 20, p.position.y + y, '#00f2ff', 1, 3, 15);
            } else if (mod.type === 'cannon') { 
                ctx.strokeStyle = '#ff0055'; ctx.strokeRect(x + size/2, y - 4, 15, 8); 
            } else if (mod.type === 'drill') {
                ctx.strokeStyle = '#ffff00'; ctx.beginPath(); ctx.moveTo(x+size/2,y-10); ctx.lineTo(x+size/2+15,y); ctx.lineTo(x+size/2,y+10); ctx.stroke();
            }
        });
        ctx.restore();
    });
    
    ctx.restore();
    drawMinimap();
    requestAnimationFrame(draw);
}

function drawSatellites() {
    currentState.satellites.forEach(s => {
        if (Math.abs(s.position.x - camera.x) > canvas.width || Math.abs(s.position.y - camera.y) > canvas.height) return;
        ctx.save(); ctx.translate(s.position.x, s.position.y); ctx.rotate(s.angle);
        ctx.strokeStyle = '#ff0055'; ctx.lineWidth = 3;
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
            const angle = (Math.PI / 3) * i; const x = Math.cos(angle) * 60; const y = Math.sin(angle) * 60;
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.closePath(); ctx.stroke();
        const pulse = (Math.sin(Date.now() / 200) + 1) / 2;
        ctx.fillStyle = `rgba(255, 0, 85, ${0.3 + pulse * 0.7})`;
        ctx.beginPath(); ctx.arc(0, 0, 20, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
    });
}

function drawMovingSatellites() {
    currentState.movingSatellites.forEach(s => {
        if (Math.abs(s.position.x - camera.x) > canvas.width || Math.abs(s.position.y - camera.y) > canvas.height) return;
        ctx.save(); ctx.translate(s.position.x, s.position.y); ctx.rotate(s.angle);
        ctx.strokeStyle = '#00f2ff'; ctx.lineWidth = 2; ctx.shadowBlur = 10; ctx.shadowColor = '#00f2ff';
        drawDiamond(ctx, 0, 0, 15);
        const pulse = (Math.sin(Date.now() / 150) + 1) / 2;
        ctx.fillStyle = `rgba(0, 242, 255, ${0.2 + pulse * 0.4})`;
        ctx.fill();
        ctx.restore();
    });
}

function drawBoundaries() {
    ctx.strokeStyle = '#ff0055'; ctx.lineWidth = 5; ctx.shadowBlur = 20;
    ctx.strokeRect(-mapSize/2, -mapSize/2, mapSize, mapSize);
    ctx.fillStyle = 'rgba(255, 0, 85, 0.05)'; ctx.fillRect(-mapSize/2, -mapSize/2, mapSize, mapSize);
}

function drawGrid() {
    const step = 150;
    ctx.strokeStyle = 'rgba(0, 242, 255, 0.08)'; ctx.lineWidth = 1;
    
    // Solo dibujar líneas visibles en pantalla (Culling)
    const startX = Math.floor((camera.x - canvas.width/2) / step) * step;
    const endX = Math.ceil((camera.x + canvas.width/2) / step) * step;
    const startY = Math.floor((camera.y - canvas.height/2) / step) * step;
    const endY = Math.ceil((camera.y + canvas.height/2) / step) * step;

    for (let x = startX; x <= endX; x += step) {
        if (x < -mapSize/2 || x > mapSize/2) continue;
        ctx.beginPath(); ctx.moveTo(x, Math.max(-mapSize/2, startY)); ctx.lineTo(x, Math.min(mapSize/2, endY)); ctx.stroke();
    }
    for (let y = startY; y <= endY; y += step) {
        if (y < -mapSize/2 || y > mapSize/2) continue;
        ctx.beginPath(); ctx.moveTo(Math.max(-mapSize/2, startX), y); ctx.lineTo(Math.min(mapSize/2, endX), y); ctx.stroke();
    }
}

function drawDiamond(ctx, x, y, size) {
    ctx.beginPath(); ctx.moveTo(x, y - size); ctx.lineTo(x + size, y); ctx.lineTo(x, y + size); ctx.lineTo(x - size, y); ctx.closePath();
    ctx.stroke(); ctx.beginPath(); ctx.moveTo(x, y - size/2); ctx.lineTo(x + size/2, y); ctx.lineTo(x, y + size/2); ctx.lineTo(x - size/2, y); ctx.closePath(); ctx.fill();
}

function drawMinimap() {
    mCtx.clearRect(0, 0, miniCanvas.width, miniCanvas.height);
    const scale = miniCanvas.width / mapSize, center = miniCanvas.width / 2;
    currentState.players.forEach(p => {
        const mx = center + p.position.x * scale, my = center + p.position.y * scale;
        mCtx.fillStyle = p.id === myId ? '#00f2ff' : '#ff0055'; mCtx.fillRect(mx-2, my-2, 4, 4);
    });
}

draw();
