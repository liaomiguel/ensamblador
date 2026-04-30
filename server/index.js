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
    Bodies.rectangle(0, -half - wallThickness/2, mapSize + wallThickness * 2, wallThickness, { isStatic: true, label: 'wall' }),
    Bodies.rectangle(0, half + wallThickness/2, mapSize + wallThickness * 2, wallThickness, { isStatic: true, label: 'wall' }),
    Bodies.rectangle(-half - wallThickness/2, 0, wallThickness, mapSize + wallThickness * 2, { isStatic: true, label: 'wall' }),
    Bodies.rectangle(half + wallThickness/2, 0, wallThickness, mapSize + wallThickness * 2, { isStatic: true, label: 'wall' })
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

const movingSatellites = [];
function spawnMovingSatellite() {
    const startX = (Math.random() - 0.5) * (mapSize - 800);
    const startY = (Math.random() - 0.5) * (mapSize - 800);
    const range = 300 + Math.random() * 500;
    const isVertical = Math.random() > 0.5;
    const body = Bodies.polygon(startX, startY, 3, 35, { 
        isStatic: true, 
        label: 'moving_satellite' 
    });
    body.plugin = { 
        startX, startY, range, isVertical, 
        speed: 0.0001 + Math.random() * 0.0002, 
        offset: Math.random() * Math.PI * 2 
    };
    movingSatellites.push(body);
    World.add(engine.world, body);
}
for (let i = 0; i < 8; i++) spawnMovingSatellite();

function spawnModule() {
    const types = ['thruster', 'cannon', 'shield', 'drill'];
    const type = types[Math.floor(Math.random() * types.length)];
    const x = (Math.random() - 0.5) * (mapSize - 100);
    const y = (Math.random() - 0.5) * (mapSize - 100);
    const body = Bodies.rectangle(x, y, 20, 20, { isSensor: true, label: 'junk_module', plugin: { type } });
    modules.push({ body, type });
    World.add(engine.world, body);
}
for (let i = 0; i < 60; i++) spawnModule();
setInterval(() => { if (modules.length < 60) spawnModule(); }, 2000);

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
        if (projectile && shipPart) {
            const playerOwner = Object.values(players).find(p => p.body?.parts?.includes(shipPart));
            // Solo aplicar daño si el proyectil NO es del mismo jugador que la parte impactada
            if (playerOwner && projectile.plugin.ownerId !== playerOwner.id) {
                damagePlayer(shipPart, 'PROJECTILE');
            }
        }

        const drillPart = [bodyA, bodyB].find(b => b.label === 'drill');
        if (drillPart && shipPart && drillPart !== shipPart) damagePlayer(shipPart, 'DRILL');

        const satellite = [bodyA, bodyB].find(b => b.label === 'satellite');
        if (shipPart && satellite) triggerSatelliteCollision(shipPart);

        const mSatellite = [bodyA, bodyB].find(b => b.label === 'moving_satellite');
        if (shipPart && mSatellite) triggerSatelliteCollision(shipPart);
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
            reorganizeShip(player);
        }
    }
}

function triggerSatelliteCollision(shipPart) {
    const player = Object.values(players).find(p => p.body?.parts?.includes(shipPart));
    if (!player || player.shipStructure.length <= 1) return;

    // Los satélites ahora solo te "desarman"
    // Soltamos el 30% de las piezas actuales
    const toDrop = Math.ceil(player.shipStructure.length * 0.3);
    
    for (let i = 0; i < toDrop; i++) {
        if (player.shipStructure.length <= 1) break; 
        const idx = Math.floor(Math.random() * (player.shipStructure.length - 1)) + 1;
        const mod = player.shipStructure.splice(idx, 1)[0];
        
        dropModule(
            player.body.position.x + (Math.random() - 0.5) * 100, 
            player.body.position.y + (Math.random() - 0.5) * 100, 
            mod.type
        );
    }
    
    rebuildShip(player);
    reorganizeShip(player);
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
            reorganizeShip(player);
            return;
        }
    }
}

io.on('connection', (socket) => {
    players[socket.id] = { id: socket.id, nickname: '', body: null, shipStructure: [{ x: 0, y: 0, type: 'core' }], inputs: {}, lastShoot: 0 };
    socket.on('join', (data) => {
        if (!players[socket.id]) players[socket.id] = { id: socket.id, nickname: '', body: null, shipStructure: [{x:0,y:0,type:'core'}], inputs: {}, lastShoot:0 };
        const p = players[socket.id];
        p.nickname = (typeof data === 'object' ? data.nickname : data) || 'PILOTO';
        p.baseSpeed = typeof data === 'object' ? data.speed : 0.001;
        p.shipStructure = [{x:0,y:0,type:'core'}];
        const core = Bodies.rectangle((Math.random()-0.5)*2000, (Math.random()-0.5)*2000, 38, 38, { label: 'core', plugin: { gridX: 0, gridY: 0 } });
        p.body = Body.create({ parts: [core], frictionAir: 0.03, restitution: 0.5, label: 'player_ship' });
        World.add(engine.world, p.body);
    });
    socket.on('input', (i) => { 
        if (players[socket.id]) {
            players[socket.id].inputs = i;
        }
    });
    socket.on('disconnect', () => { if (players[socket.id]) { if (players[socket.id].body) World.remove(engine.world, players[socket.id].body); delete players[socket.id]; } });
});

function reorganizeShip(player) {
    if (!player.body) return;
    
    const mods = player.shipStructure.filter(m => m.type !== 'core');
    const drills = mods.filter(m => m.type === 'drill');
    const cannons = mods.filter(m => m.type === 'cannon');
    const shields = mods.filter(m => m.type === 'shield');
    const thrusters = mods.filter(m => m.type === 'thruster');

    const final = [{ x: 0, y: 0, type: 'core' }];
    const occupied = new Set(["0,0"]);

    const tryPlace = (type, x, y) => {
        const key = `${x},${y}`;
        if (occupied.has(key)) return false;
        const hasNeighbor = [[1,0],[-1,0],[0,1],[0,-1]].some(([dx, dy]) => occupied.has(`${x+dx},${y+dy}`));
        if (hasNeighbor) {
            final.push({ x, y, type });
            occupied.add(key);
            return true;
        }
        return false;
    };

    // Slots tácticos para silueta de "Punta de Flecha" (Como en la imagen de referencia)
    const drillSlots = [[1,0], [2,0], [3,0], [4,0], [5,0]];
    const shieldSlots = [[-1,0], [0,1], [0,-1], [1,1], [1,-1], [-1,1], [-1,-1], [-2,0]];
    const thrusterSlots = [[0,2], [0,-2], [1,2], [1,-2], [-1,2], [-1,-2], [0,3], [0,-3]];
    const cannonSlots = [[1,1], [1,-1], [2,1], [2,-1], [0,3], [0,-3], [1,3], [1,-3]];

    // 1. Taladros en la espina dorsal (Punta)
    drills.forEach(m => { for(let s of drillSlots) if(tryPlace('drill', s[0], s[1])) break; });
    // 2. Propulsores en las alas
    thrusters.forEach(m => { for(let s of thrusterSlots) if(tryPlace('thruster', s[0], s[1])) break; });
    // 3. Cañones en los extremos
    cannons.forEach(m => { for(let s of cannonSlots) if(tryPlace('cannon', s[0], s[1])) break; });
    // 4. Escudos como blindaje y cuerpo
    shields.forEach(m => { for(let s of shieldSlots) if(tryPlace('shield', s[0], s[1])) break; });

    // Fallback por si sobran piezas
    const counts = { drill: drills.length, cannon: cannons.length, thruster: thrusters.length, shield: shields.length };
    const placed = { drill: 0, cannon: 0, thruster: 0, shield: 0 };
    final.forEach(f => { if(f.type !== 'core') placed[f.type]++; });

    ['drill', 'cannon', 'thruster', 'shield'].forEach(t => {
        while(placed[t] < counts[t]) {
            let found = false;
            for(let r=1; r<10 && !found; r++) {
                for(let ix=-r; ix<=r && !found; ix++) {
                    for(let iy=-r; iy<=r && !found; iy++) {
                        if(tryPlace(t, ix, iy)) { placed[t]++; found = true; }
                    }
                }
            }
            if(!found) break;
        }
    });

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

const EMIT_INTERVAL = 45;
let lastEmitTime = 0;

setInterval(() => {
    const now = Date.now();
    Engine.update(engine, 1000 / 60);

    Object.values(players).forEach(p => {
        if (!p.body) return;
        
        let thrusterPower = (p.shipStructure.filter(m => m.type === 'thruster').length * 0.002);
        let force = (p.baseSpeed || 0.001) + thrusterPower;
        const torque = 0.06;
        
        // Freno (E): Detiene el movimiento constante y aplica fricción
        if (p.inputs.brake) { 
            Body.setVelocity(p.body, { x: p.body.velocity.x * 0.9, y: p.body.velocity.y * 0.9 }); 
            Body.setAngularVelocity(p.body, p.body.angularVelocity * 0.9); 
            p.isBraking = true; 
        } else {
            p.isBraking = false;
        }
        
        // Movimiento constante "Levitación" (0.0006 es muy lento y sutil)
        const baseDrift = 0.0006;
        let finalPush = p.isBraking ? 0 : baseDrift;

        if (p.inputs.boost && (!p.lastBoost || now - p.lastBoost > 2000)) { 
            p.boostActive = true; 
            p.boostStartTime = now; 
            p.lastBoost = now; 
        }
        if (p.boostActive) { 
            if (now - p.boostStartTime < 500) force *= 3; 
            else p.boostActive = false; 
        }

        // Si presiona W, suma potencia. Si no, mantiene el drift base.
        if (p.inputs.up) finalPush += force;
        
        Body.applyForce(p.body, p.body.position, { 
            x: Math.cos(p.body.angle) * finalPush, 
            y: Math.sin(p.body.angle) * finalPush 
        });

        if (p.inputs.left) Body.setAngularVelocity(p.body, -torque);
        if (p.inputs.right) Body.setAngularVelocity(p.body, torque);
        
        if (p.inputs.shoot && now - p.lastShoot > 250) {
            p.shipStructure.filter(m => m.type === 'cannon').forEach(m => {
                const angle = p.body.angle;
                // Ajustamos sx y sy para que la bala salga un poco más adelante del cañón (+50 en lugar de +40)
                const sx = p.body.position.x + (m.x * 40 * Math.cos(angle)) - (m.y * 40 * Math.sin(angle)) + Math.cos(angle) * 50;
                const sy = p.body.position.y + (m.x * 40 * Math.sin(angle)) + (m.y * 40 * Math.cos(angle)) + Math.sin(angle) * 50;
                
                // Añadimos plugin.ownerId para identificar quién disparó
                const b = Bodies.circle(sx, sy, 5, { 
                    label: 'projectile', 
                    frictionAir: 0, 
                    restitution: 1,
                    plugin: { ownerId: p.id } 
                });
                
                Body.setVelocity(b, { x: Math.cos(angle) * 22, y: Math.sin(angle) * 22 });
                projectiles.push({ body: b, life: 70 });
                World.add(engine.world, b);
            });
            p.lastShoot = now;
        }
    });

    // Movimiento de Satélites Patrulla
    movingSatellites.forEach(s => {
        const p = s.plugin;
        const delta = Math.sin(now * p.speed + p.offset) * p.range;
        const nx = p.isVertical ? p.startX : p.startX + delta;
        const ny = p.isVertical ? p.startY + delta : p.startY;
        Body.setPosition(s, { x: nx, y: ny });
    });

    for (let i = projectiles.length - 1; i >= 0; i--) {
        projectiles[i].life--;
        if (projectiles[i].life <= 0) { World.remove(engine.world, projectiles[i].body); projectiles.splice(i, 1); }
    }

    if (now - lastEmitTime >= EMIT_INTERVAL) {
        lastEmitTime = now;
        io.emit('s', { 
            p: Object.values(players).filter(p => p.nickname && p.body).map(p => ({ 
                i: p.id, 
                n: p.nickname, 
                pos: {x: Math.round(p.body.position.x), y: Math.round(p.body.position.y)}, 
                a: Number(p.body.angle.toFixed(3)), 
                m: p.shipStructure, 
                b: p.boostActive, 
                br: p.isBraking 
            })),
            m: modules.map(m => ({ x: Math.round(m.body.position.x), y: Math.round(m.body.position.y), t: m.type })),
            pr: projectiles.map(p => ({ x: Math.round(p.body.position.x), y: Math.round(p.body.position.y) })),
            sa: obstacles.map(o => ({ x: Math.round(o.position.x), y: Math.round(o.position.y), a: Number(o.angle.toFixed(3)) })),
            ms: movingSatellites.map(s => ({ x: Math.round(s.position.x), y: Math.round(s.position.y), a: Number(s.angle.toFixed(3)) }))
        });
    }
}, 1000 / 60);

httpServer.listen(PORT, '0.0.0.0', () => console.log(`🚀 ENSAMBLADOR.io ejecutándose en el puerto ${PORT}`));
