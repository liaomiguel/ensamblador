import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import Matter from 'matter-js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, '../public')));

const Engine = Matter.Engine,
      World = Matter.World,
      Bodies = Matter.Bodies,
      Body = Matter.Body;

const engine = Engine.create();
engine.gravity.y = 0;

const players = {};
const modules = [];
const projectiles = [];
const obstacles = [];
const mapSize = 3000;

const wallThickness = 100;
const half = mapSize / 2;
const walls = [
    Bodies.rectangle(0, -half - wallThickness/2, mapSize, wallThickness, { isStatic: true, label: 'wall' }),
    Bodies.rectangle(0, half + wallThickness/2, mapSize, wallThickness, { isStatic: true, label: 'wall' }),
    Bodies.rectangle(-half - wallThickness/2, 0, wallThickness, mapSize, { isStatic: true, label: 'wall' }),
    Bodies.rectangle(half + wallThickness/2, 0, wallThickness, mapSize, { isStatic: true, label: 'wall' })
];
World.add(engine.world, walls);

function spawnSatellite() {
    const x = (Math.random() - 0.5) * (mapSize - 200);
    const y = (Math.random() - 0.5) * (mapSize - 200);
    const body = Bodies.polygon(x, y, 6, 60, { isStatic: true, label: 'satellite' });
    obstacles.push(body);
    World.add(engine.world, body);
}
for (let i = 0; i < 10; i++) spawnSatellite();

function spawnModule() {
    const types = ['thruster', 'cannon', 'shield', 'drill'];
    const type = types[Math.floor(Math.random() * types.length)];
    const x = (Math.random() - 0.5) * (mapSize - 100);
    const y = (Math.random() - 0.5) * (mapSize - 100);
    const body = Bodies.rectangle(x, y, 20, 20, { isSensor: true, label: 'junk_module', plugin: { type } });
    modules.push({ body, type });
    World.add(engine.world, body);
}
for (let i = 0; i < 150; i++) spawnModule();

function rebuildShip(player) {
    if (!player.body) return;
    const oldPos = player.body.position;
    const oldAngle = player.body.angle;
    const oldVel = player.body.velocity;
    World.remove(engine.world, player.body);
    const parts = player.shipStructure.map(m => Bodies.rectangle(m.x * 40, m.y * 40, 38, 38, { label: m.type, plugin: { gridX: m.x, gridY: m.y } }));
    player.body = Body.create({ parts, frictionAir: 0.03, restitution: 0.5, label: 'player_ship' });
    Body.setPosition(player.body, oldPos);
    Body.setAngle(player.body, oldAngle);
    Body.setVelocity(player.body, oldVel);
    World.add(engine.world, player.body);
}

function dropModule(x, y, type) {
    const body = Bodies.rectangle(x, y, 20, 20, { isSensor: true, label: 'junk_module', plugin: { type } });
    modules.push({ body, type });
    World.add(engine.world, body);
}

Matter.Events.on(engine, 'collisionStart', (event) => {
    event.pairs.forEach(pair => {
        const { bodyA, bodyB } = pair;
        const shipPart = [bodyA, bodyB].find(b => ['core', 'thruster', 'cannon', 'shield', 'drill'].includes(b.label));
        const junkMod = [bodyA, bodyB].find(b => b.label === 'junk_module');
        if (shipPart && junkMod) attachToPlayer(shipPart, junkMod);

        const projectile = [bodyA, bodyB].find(b => b.label === 'projectile');
        if (projectile && shipPart) damagePlayer(shipPart, 'PROJECTILE');

        const drillPart = [bodyA, bodyB].find(b => b.label === 'drill');
        if (drillPart && shipPart && drillPart !== shipPart) damagePlayer(shipPart, 'DRILL');

        const satellite = [bodyA, bodyB].find(b => b.label === 'satellite');
        if (shipPart && satellite) triggerSatelliteCollision(shipPart);
    });
});

function damagePlayer(shipPart, cause) {
    const player = Object.values(players).find(p => p.body?.parts?.includes(shipPart));
    if (!player) return;
    const gridX = shipPart.plugin?.gridX;
    const gridY = shipPart.plugin?.gridY;

    if (gridX === 0 && gridY === 0) {
        io.to(player.id).emit('gameover', { reason: `NÚCLEO DESTRUIDO POR: ${cause}` });
        if (player.body) World.remove(engine.world, player.body);
        player.body = null;
        player.nickname = '';
    } else if (gridX !== undefined) {
        const idx = player.shipStructure.findIndex(m => m.x === gridX && m.y === gridY);
        if (idx !== -1) {
            const mod = player.shipStructure.splice(idx, 1)[0];
            dropModule(shipPart.position.x, shipPart.position.y, mod.type);
            rebuildShip(player);
        }
    }
}

function triggerSatelliteCollision(shipPart) {
    const player = Object.values(players).find(p => p.body?.parts?.includes(shipPart));
    if (!player) return;
    if (player.shipStructure.length >= 6) {
        const toDrop = Math.floor(player.shipStructure.length / 2);
        for (let i = 0; i < toDrop; i++) {
            if (player.shipStructure.length <= 1) break;
            const idx = Math.floor(Math.random() * (player.shipStructure.length - 1)) + 1;
            const mod = player.shipStructure.splice(idx, 1)[0];
            dropModule(player.body.position.x + mod.x * 40, player.body.position.y + mod.y * 40, mod.type);
        }
        rebuildShip(player);
    }
    if (shipPart.label === 'core') {
        io.to(player.id).emit('gameover', { reason: 'SOBRECARGA POR SATÉLITE' });
        if (player.body) World.remove(engine.world, player.body);
        player.body = null;
        player.nickname = '';
    }
}

function attachToPlayer(shipPart, junkBody) {
    const player = Object.values(players).find(p => p.body?.parts?.includes(shipPart));
    if (!player || player.shipStructure.length >= 50) return;
    const type = junkBody.plugin.type;
    const gridX = shipPart.plugin?.gridX;
    const gridY = shipPart.plugin?.gridY;
    if (gridX === undefined) return;

    const neighbors = [{x:1,y:0}, {x:-1,y:0}, {x:0,y:1}, {x:0,y:-1}];
    for (let n of neighbors) {
        const nx = gridX + n.x;
        const ny = gridY + n.y;
        if (!player.shipStructure.some(s => s.x === nx && s.y === ny)) {
            player.shipStructure.push({ x: nx, y: ny, type });
            const idx = modules.findIndex(m => m.body === junkBody);
            if (idx !== -1) { World.remove(engine.world, junkBody); modules.splice(idx, 1); spawnModule(); }
            rebuildShip(player);
            return;
        }
    }
}

io.on('connection', (socket) => {
    players[socket.id] = { id: socket.id, nickname: '', body: null, shipStructure: [{ x: 0, y: 0, type: 'core' }], inputs: {}, lastShoot: 0 };
    socket.on('join', (name) => {
        if (!players[socket.id]) players[socket.id] = { id: socket.id, nickname: '', body: null, shipStructure: [{x:0,y:0,type:'core'}], inputs: {}, lastShoot:0 };
        const p = players[socket.id];
        p.nickname = name || 'UNK_USER';
        p.shipStructure = [{x:0,y:0,type:'core'}];
        const core = Bodies.rectangle((Math.random()-0.5)*2000, (Math.random()-0.5)*2000, 38, 38, { label: 'core', plugin: { gridX: 0, gridY: 0 } });
        p.body = Body.create({ parts: [core], frictionAir: 0.03, restitution: 0.5, label: 'player_ship' });
        World.add(engine.world, p.body);
    });
    socket.on('input', (i) => { 
        if (players[socket.id]) {
            const old = players[socket.id].inputs;
            players[socket.id].inputs = i;
            if (i.rotate && !old.rotate) rotateShip(players[socket.id]);
            if (i.drop && !old.drop) ejectModule(players[socket.id]);
        }
    });
    socket.on('disconnect', () => { if (players[socket.id]) { if (players[socket.id].body) World.remove(engine.world, players[socket.id].body); delete players[socket.id]; } });
});

function rotateShip(player) {
    if (!player.body) return;
    player.shipStructure = player.shipStructure.map(mod => mod.type === 'core' ? mod : { ...mod, x: -mod.y, y: mod.x });
    const toProcess = [...player.shipStructure.filter(m => m.type !== 'core')];
    toProcess.sort((a, b) => (Math.abs(a.x) + Math.abs(a.y)) - (Math.abs(b.x) + Math.abs(b.y)));
    const final = [{ x: 0, y: 0, type: 'core' }];
    for (let mod of toProcess) {
        if (hasNeighbor(mod.x, mod.y, final)) final.push(mod);
        else { const spot = findNearestSpot(mod.x, mod.y, final); final.push({ x: spot.x, y: spot.y, type: mod.type }); }
    }
    player.shipStructure = final;
    rebuildShip(player);
}

function ejectModule(player) {
    if (!player.body || player.shipStructure.length <= 1) return;
    const idx = Math.floor(Math.random() * (player.shipStructure.length - 1)) + 1;
    const mod = player.shipStructure.splice(idx, 1)[0];
    dropModule(player.body.position.x + mod.x * 20, player.body.position.y + mod.y * 20, mod.type);
    rebuildShip(player);
}

function hasNeighbor(x, y, structure) { return structure.some(m => (Math.abs(m.x - x) === 1 && m.y === y) || (Math.abs(m.y - y) === 1 && m.x === x)); }
function findNearestSpot(tx, ty, s) {
    let best = {x:0,y:1}, min = Infinity;
    const nb = [{x:1,y:0},{x:-1,y:0},{x:0,y:1},{x:0,y:-1}];
    for (let m of s) { for (let n of nb) {
        const nx = m.x + n.x, ny = m.y + n.y;
        if (!s.some(i => i.x === nx && i.y === ny)) {
            const d = Math.abs(nx - tx) + Math.abs(ny - ty);
            if (d < min) { min = d; best = { x: nx, y: ny }; }
        }
    }}
    return best;
}

// Optimización: Emitir estado a ~22Hz en lugar de 60Hz para ahorrar ancho de banda
const EMIT_INTERVAL = 45; 
let lastEmitTime = 0;

setInterval(() => {
    const now = Date.now();
    Engine.update(engine, 1000 / 60);

    Object.values(players).forEach(p => {
        if (!p.body) return;
        let force = 0.012 + (p.shipStructure.filter(m => m.type === 'thruster').length * 0.006);
        const torque = 0.12;
        if (p.inputs.brake) { 
            Body.setVelocity(p.body, { x: p.body.velocity.x * 0.9, y: p.body.velocity.y * 0.9 }); 
            Body.setAngularVelocity(p.body, p.body.angularVelocity * 0.9); 
            p.isBraking = true; 
        } else p.isBraking = false;
        
        if (p.inputs.boost && (!p.lastBoost || now - p.lastBoost > 2000)) { 
            p.boostActive = true; 
            p.boostStartTime = now; 
            p.lastBoost = now; 
        }
        if (p.boostActive) { 
            if (now - p.boostStartTime < 500) force *= 3; 
            else p.boostActive = false; 
        }
        if (p.inputs.up) Body.applyForce(p.body, p.body.position, { x: Math.cos(p.body.angle) * force, y: Math.sin(p.body.angle) * force });
        if (p.inputs.left) Body.setAngularVelocity(p.body, -torque);
        if (p.inputs.right) Body.setAngularVelocity(p.body, torque);
        
        if (p.inputs.shoot && now - p.lastShoot > 250) {
            p.shipStructure.filter(m => m.type === 'cannon').forEach(m => {
                const angle = p.body.angle;
                const sx = p.body.position.x + (m.x * 40 * Math.cos(angle)) - (m.y * 40 * Math.sin(angle)) + Math.cos(angle) * 40;
                const sy = p.body.position.y + (m.x * 40 * Math.sin(angle)) + (m.y * 40 * Math.cos(angle)) + Math.sin(angle) * 40;
                const b = Bodies.circle(sx, sy, 5, { label: 'projectile', frictionAir: 0, restitution: 1 });
                Body.setVelocity(b, { x: Math.cos(angle) * 22, y: Math.sin(angle) * 22 });
                projectiles.push({ body: b, life: 70 });
                World.add(engine.world, b);
            });
            p.lastShoot = now;
        }
    });

    for (let i = projectiles.length - 1; i >= 0; i--) {
        projectiles[i].life--;
        if (projectiles[i].life <= 0) { World.remove(engine.world, projectiles[i].body); projectiles.splice(i, 1); }
    }

    // Solo emitir si ha pasado el intervalo para ahorrar red
    if (now - lastEmitTime >= EMIT_INTERVAL) {
        lastEmitTime = now;
        io.emit('s', { // 's' para state
            p: Object.values(players).filter(p => p.nickname && p.body).map(p => ({ 
                i: p.id, 
                n: p.nickname, 
                pos: {x: Math.round(p.body.position.x), y: Math.round(p.body.position.y)}, // Redondear para ahorrar bytes
                a: Number(p.body.angle.toFixed(3)), 
                m: p.shipStructure, 
                b: p.boostActive, 
                br: p.isBraking 
            })),
            m: modules.map(m => ({ x: Math.round(m.body.position.x), y: Math.round(m.body.position.y), t: m.type })),
            pr: projectiles.map(p => ({ x: Math.round(p.body.position.x), y: Math.round(p.body.position.y) })),
            sa: obstacles.map(o => ({ x: Math.round(o.position.x), y: Math.round(o.position.y), a: Number(o.angle.toFixed(3)) }))
        });
    }
}, 1000 / 60);

httpServer.listen(PORT, '0.0.0.0', () => console.log(`🚀 ENSAMBLADOR.io ejecutándose en el puerto ${PORT}`));
