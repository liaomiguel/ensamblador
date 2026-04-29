const socket = io();
const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
const miniCanvas = document.getElementById('minimap-canvas');
const mCtx = miniCanvas.getContext('2d');

const menuOverlay = document.getElementById('menu-overlay');
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
let camera = { x: 0, y: 0 };
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

const inputs = { up: false, left: false, right: false, down: false, shoot: false, boost: false, brake: false, rotate: false };

window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k === 'w' || e.key === 'ArrowUp') inputs.up = true;
    if (k === 'a' || e.key === 'ArrowLeft') inputs.left = true;
    if (k === 'd' || e.key === 'ArrowRight') inputs.right = true;
    if (k === 's' || e.key === 'ArrowDown') inputs.down = true;
    if (e.key === ' ') inputs.shoot = true;
    if (e.key === 'Shift') inputs.boost = true;
    if (k === 'e') inputs.brake = true;
    if (k === 'r') inputs.rotate = true;
    socket.emit('input', inputs);
});

window.addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase();
    if (k === 'w' || e.key === 'ArrowUp') inputs.up = false;
    if (k === 'a' || e.key === 'ArrowLeft') inputs.left = false;
    if (k === 'd' || e.key === 'ArrowRight') inputs.right = false;
    if (k === 's' || e.key === 'ArrowDown') inputs.down = false;
    if (e.key === ' ') inputs.shoot = false;
    if (e.key === 'Shift') inputs.boost = false;
    if (k === 'e') inputs.brake = false;
    if (k === 'r') inputs.rotate = false;
    socket.emit('input', inputs);
});

socket.on('connect', () => { myId = socket.id; });

socket.on('state', (state) => {
    players = state.players || [];
    modules = state.modules || [];
    myProjectiles = state.projectiles || [];
    satellites = state.satellites || [];
    const me = players.find(p => p.id === myId);
    if (me) {
        camera.x = me.position.x;
        camera.y = me.position.y;
        document.getElementById('module-count').innerText = `Modules: ${me.modules.length}`;
    }
    updateLeaderboard();
});

function updateLeaderboard() {
    const list = document.getElementById('leaderboard-list');
    list.innerHTML = '';
    const sorted = [...players].sort((a, b) => b.modules.length - a.modules.length);
    sorted.slice(0, 5).forEach(p => {
        const li = document.createElement('li');
        li.innerHTML = `<span>${p.nickname || 'UNK_USER'}</span> <strong>${p.modules.length}</strong>`;
        if (p.id === myId) li.style.color = '#00f2ff';
        list.appendChild(li);
    });
}

socket.on('gameover', () => { menuOverlay.style.display = 'flex'; });

playButton.addEventListener('click', () => {
    const name = nicknameInput.value.trim();
    socket.emit('join', name);
    menuOverlay.style.display = 'none';
});

function drawDiamond(ctx, x, y, size) {
    ctx.beginPath();
    ctx.moveTo(x, y - size);
    ctx.lineTo(x + size, y);
    ctx.lineTo(x, y + size);
    ctx.lineTo(x - size, y);
    ctx.closePath();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, y - size/2);
    ctx.lineTo(x + size/2, y);
    ctx.lineTo(x, y + size/2);
    ctx.lineTo(x - size/2, y);
    ctx.closePath();
    ctx.fill();
}

function drawMinimap() {
    mCtx.clearRect(0, 0, miniCanvas.width, miniCanvas.height);
    const scale = miniCanvas.width / (mapSize * 2);
    const center = miniCanvas.width / 2;
    mCtx.strokeStyle = 'rgba(0, 242, 255, 0.1)';
    for(let i=0; i<miniCanvas.width; i+=20) {
        mCtx.beginPath(); mCtx.moveTo(i, 0); mCtx.lineTo(i, miniCanvas.height); mCtx.stroke();
        mCtx.beginPath(); mCtx.moveTo(0, i); mCtx.lineTo(miniCanvas.width, i); mCtx.stroke();
    }
    players.forEach(p => {
        const mx = center + p.position.x * scale;
        const my = center + p.position.y * scale;
        mCtx.fillStyle = p.id === myId ? '#00f2ff' : '#ff0055';
        mCtx.fillRect(mx-2, my-2, 4, 4);
    });
}

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(canvas.width / 2 - camera.x, canvas.height / 2 - camera.y);
    
    drawBoundaries();
    drawGrid();
    drawSatellites();

    particles = particles.filter(p => {
        p.x += p.vx;
        p.y += p.vy;
        p.life--;
        ctx.globalAlpha = p.life / p.maxLife;
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x, p.y, 2, 2);
        return p.life > 0;
    });
    ctx.globalAlpha = 1;
    
    modules.forEach(m => {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
        ctx.strokeStyle = moduleColors[m.type] || '#fff';
        ctx.lineWidth = 1;
        ctx.shadowBlur = 5;
        ctx.shadowColor = ctx.strokeStyle;
        drawDiamond(ctx, m.position.x, m.position.y, 10);
    });
    
    myProjectiles.forEach(p => {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(p.position.x, p.position.y);
        ctx.lineTo(p.position.x - 10, p.position.y);
        ctx.stroke();
    });
    
    players.forEach(p => {
        ctx.save();
        ctx.translate(p.position.x, p.position.y);
        const topModY = Math.min(...p.modules.map(m => m.y));
        const nicknameOffset = topModY * 40 - 30; 
        ctx.fillStyle = p.id === myId ? '#00f2ff' : '#fff';
        ctx.font = '12px "Share Tech Mono"';
        ctx.textAlign = 'center';
        ctx.fillText(`> ${p.nickname || 'UNK_USER'}`, 0, nicknameOffset);
        if (p.isBraking) createParticles(p.position.x, p.position.y, '#ffaa00', 2, 4, 10);
        ctx.rotate(p.angle);
        p.modules.forEach(mod => {
            const size = 36;
            const x = mod.x * 40;
            const y = mod.y * 40;
            ctx.strokeStyle = moduleColors[mod.type];
            ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
            ctx.lineWidth = 2;
            ctx.shadowBlur = 10;
            ctx.shadowColor = ctx.strokeStyle;
            ctx.strokeRect(x - size/2, y - size/2, size, size);
            ctx.fillRect(x - size/2, y - size/2, size, size);
            if (mod.type === 'core') {
                ctx.fillStyle = '#fff';
                ctx.fillRect(x - 5, y - 5, 10, 10);
            } else if (mod.type === 'thruster') {
                ctx.strokeStyle = p.boostActive ? '#ffffff' : '#00f2ff';
                ctx.beginPath();
                ctx.moveTo(x - size/2, y - 5);
                ctx.lineTo(x - size/2 - (p.boostActive ? 45 : 18), y);
                ctx.lineTo(x - size/2, y + 5);
                ctx.stroke();
                if (p.boostActive) createParticles(p.position.x + x - 20, p.position.y + y, '#00f2ff', 1, 3, 15);
            } else if (mod.type === 'cannon') {
                ctx.strokeStyle = '#ff0055';
                ctx.strokeRect(x + size/2, y - 4, 15, 8);
            } else if (mod.type === 'drill') {
                ctx.strokeStyle = '#ffff00';
                ctx.beginPath();
                ctx.moveTo(x + size/2, y - 10);
                ctx.lineTo(x + size/2 + 15, y);
                ctx.lineTo(x + size/2, y + 10);
                ctx.stroke();
            }
        });
        ctx.restore();
    });
    ctx.restore();
    drawMinimap();
    requestAnimationFrame(draw);
}

function drawSatellites() {
    satellites.forEach(s => {
        ctx.save();
        ctx.translate(s.position.x, s.position.y);
        ctx.rotate(s.angle);
        ctx.strokeStyle = '#ff0055';
        ctx.lineWidth = 3;
        ctx.shadowBlur = 15;
        ctx.shadowColor = '#ff0055';
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
            const angle = (Math.PI / 3) * i;
            const x = Math.cos(angle) * 60;
            const y = Math.sin(angle) * 60;
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.stroke();
        const pulse = (Math.sin(Date.now() / 200) + 1) / 2;
        ctx.fillStyle = `rgba(255, 0, 85, ${0.3 + pulse * 0.7})`;
        ctx.beginPath();
        ctx.arc(0, 0, 20, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    });
}

function drawBoundaries() {
    ctx.strokeStyle = '#ff0055';
    ctx.lineWidth = 5;
    ctx.shadowBlur = 20;
    ctx.strokeRect(-mapSize/2, -mapSize/2, mapSize, mapSize);
    ctx.fillStyle = 'rgba(255, 0, 85, 0.05)';
    ctx.fillRect(-mapSize/2, -mapSize/2, mapSize, mapSize);
}

function drawGrid() {
    const size = mapSize/2;
    const step = 150;
    ctx.strokeStyle = 'rgba(0, 242, 255, 0.1)';
    ctx.lineWidth = 1;
    for (let x = -size; x <= size; x += step) {
        ctx.beginPath(); ctx.moveTo(x, -size); ctx.lineTo(x, size); ctx.stroke();
    }
    for (let y = -size; y <= size; y += step) {
        ctx.beginPath(); ctx.moveTo(-size, y); ctx.lineTo(size, y); ctx.stroke();
    }
}

draw();
