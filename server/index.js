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

// Matter.js engine
const Engine = Matter.Engine,
      World = Matter.World,
      Bodies = Matter.Bodies,
      Body = Matter.Body,
      Composite = Matter.Composite;

const engine = Engine.create();
engine.gravity.y = 0;

const players = {};
const modules = [];
const projectiles = [];
const mapSize = 3000;

// Map Boundaries (Walls)
const wallThickness = 100;
const half = mapSize / 2;
const walls = [
    Bodies.rectangle(0, -half - wallThickness/2, mapSize, wallThickness, { isStatic: true, label: 'wall' }), // Top
    Bodies.rectangle(0, half + wallThickness/2, mapSize, wallThickness, { isStatic: true, label: 'wall' }),  // Bottom
    Bodies.rectangle(-half - wallThickness/2, 0, wallThickness, mapSize, { isStatic: true, label: 'wall' }), // Left
    Bodies.rectangle(half + wallThickness/2, 0, wallThickness, mapSize, { isStatic: true, label: 'wall' })   // Right
];
World.add(engine.world, walls);

const obstacles = [];
function spawnSatellite() {
    const x = (Math.random() - 0.5) * mapSize;
    const y = (Math.random() - 0.5) * mapSize;
    const body = Bodies.polygon(x, y, 6, 60, { isStatic: true, label: 'satellite' });
    obstacles.push(body);
    World.add(engine.world, body);
}
for (let i = 0; i < 8; i++) spawnSatellite();

// Module generation
function spawnModule() {
    const types = ['thruster', 'cannon', 'shield', 'drill'];
    const type = types[Math.floor(Math.random() * types.length)];
    const x = (Math.random() - 0.5) * mapSize;
    const y = (Math.random() - 0.5) * mapSize;
    
    const body = Bodies.rectangle(x, y, 20, 20, { 
        isSensor: true,
        label: 'junk_module',
        plugin: { type }
    });
    
    modules.push({ body, type });
    World.add(engine.world, body);
}

for (let i = 0; i < 150; i++) spawnModule();

function rebuildShip(player) {
    const oldPos = player.body.position;
    const oldAngle = player.body.angle;
    const oldVel = player.body.velocity;
    
    World.remove(engine.world, player.body);

    const parts = player.shipStructure.map(m => {
        const part = Bodies.rectangle(m.x * 40, m.y * 40, 38, 38, {
            label: m.type,
            plugin: { gridX: m.x, gridY: m.y }
        });
        return part;
    });

    const compoundBody = Body.create({
        parts: parts,
        frictionAir: 0.05,
        restitution: 0.5,
        label: 'player_ship'
    });

    Body.setPosition(compoundBody, oldPos);
    Body.setAngle(compoundBody, oldAngle);
    Body.setVelocity(compoundBody, oldVel);
    
    player.body = compoundBody;
    World.add(engine.world, compoundBody);
}

function dropModule(x, y, type) {
    const body = Bodies.rectangle(x, y, 20, 20, { 
        isSensor: true,
        label: 'junk_module',
        plugin: { type }
    });
    modules.push({ body, type });
    World.add(engine.world, body);
}

Matter.Events.on(engine, 'collisionStart', (event) => {
    event.pairs.forEach(pair => {
        const { bodyA, bodyB } = pair;

        // Player Part - Junk Module
        const shipPart = [bodyA, bodyB].find(b => ['core', 'thruster', 'cannon', 'shield', 'drill'].includes(b.label));
        const junkMod = [bodyA, bodyB].find(b => b.label === 'junk_module');

        if (shipPart && junkMod) {
            attachToPlayer(shipPart, junkMod);
        }

        // Projectile - Ship Part
        const projectile = [bodyA, bodyB].find(b => b.label === 'projectile');
        if (projectile && shipPart) {
            damagePlayer(shipPart, projectile);
        }

        // Drill - Ship Part (Melee)
        const drillPart = [bodyA, bodyB].find(b => b.label === 'drill');
        if (drillPart && shipPart && drillPart !== shipPart) {
            damagePlayer(shipPart, drillPart, true);
        }

        // Ship Part - Satellite
        const satellite = [bodyA, bodyB].find(b => b.label === 'satellite');
        if (shipPart && satellite) {
            triggerSatelliteCollision(shipPart);
        }
    });
});

function triggerSatelliteCollision(shipPart) {
    const player = Object.values(players).find(p => p.body.parts && p.body.parts.some(part => part === shipPart));
    if (!player || player.shipStructure.length < 6) return;

    // Massive damage: Drop half of modules
    const toDrop = Math.floor(player.shipStructure.length / 2);
    for (let i = 0; i < toDrop; i++) {
        if (player.shipStructure.length <= 1) break;
        const idx = Math.floor(Math.random() * (player.shipStructure.length - 1)) + 1; // Don't drop core
        const mod = player.shipStructure.splice(idx, 1)[0];
        dropModule(player.body.position.x + mod.x * 40, player.body.position.y + mod.y * 40, mod.type);
    }
    rebuildShip(player);
}

function attachToPlayer(shipPart, junkBody) {
    // Find player by searching for the body part in their compound body
    const player = Object.values(players).find(p => 
        p.body.parts && p.body.parts.some(part => part === shipPart)
    );
    
    if (!player) return;

    const type = junkBody.plugin.type;
    const shipParts = player.shipStructure;
    
    // Find adjacent slot to the specific part that touched the module
    const gridX = shipPart.plugin.gridX;
    const gridY = shipPart.plugin.gridY;
    
    const neighbors = [{x: 1, y: 0}, {x: -1, y: 0}, {x: 0, y: 1}, {x: 0, y: -1}];
    for (let n of neighbors) {
        const nx = gridX + n.x;
        const ny = gridY + n.y;
        if (!shipParts.find(p => p.x === nx && p.y === ny)) {
            player.shipStructure.push({ x: nx, y: ny, type });
            
            const idx = modules.findIndex(m => m.body === junkBody);
            if (idx !== -1) {
                World.remove(engine.world, junkBody);
                modules.splice(idx, 1);
                spawnModule();
            }
            rebuildShip(player);
            return;
        }
    }
}

function damagePlayer(shipBody, attackerBody, contactPoint, isDrill = false) {
    // Find parent ship body
    const player = Object.values(players).find(p => p.body === shipBody || p.body.parts.includes(shipBody));
    if (!player) return;

    // Determine which part was hit
    // If it's a compound body hit, the sub-part is in pair.bodyA/B
    const hitPart = shipBody; // This is actually the sub-part in Matter collisions
    const gridX = hitPart.plugin.gridX;
    const gridY = hitPart.plugin.gridY;

    if (gridX === 0 && gridY === 0) {
        // HIT CORE -> GAMEOVER
        io.to(player.id).emit('gameover');
        World.remove(engine.world, player.body);
        delete players[player.id];
    } else {
        // HIT MODULE -> DETACH/DESTROY
        const modIdx = player.shipStructure.findIndex(m => m.x === gridX && m.y === gridY);
        if (modIdx !== -1) {
            const mod = player.shipStructure[modIdx];
            player.shipStructure.splice(modIdx, 1);
            dropModule(player.body.position.x + gridX * 40, player.body.position.y + gridY * 40, mod.type);
            rebuildShip(player);
        }
    }

    // Remove projectile if hit
    if (attackerBody.label === 'projectile') {
        const pIdx = projectiles.findIndex(p => p.body === attackerBody);
        if (pIdx !== -1) {
            World.remove(engine.world, attackerBody);
            projectiles.splice(pIdx, 1);
        }
    }
}

io.on('connection', (socket) => {
    players[socket.id] = {
        id: socket.id,
        nickname: '',
        body: Bodies.rectangle(0, 0, 40, 40), // Placeholder
        shipStructure: [{ x: 0, y: 0, type: 'core' }],
        inputs: { up: false, left: false, right: false, down: false, shoot: false, boost: false, brake: false, rotate: false },
        lastShoot: 0
    };

    socket.on('join', (name) => {
        if (!players[socket.id]) {
            players[socket.id] = {
                id: socket.id,
                nickname: '',
                body: null,
                shipStructure: [{ x: 0, y: 0, type: 'core' }],
                inputs: { up: false, left: false, right: false, down: false, shoot: false, boost: false, brake: false, rotate: false },
                lastShoot: 0
            };
        }
        
        const player = players[socket.id];
        player.nickname = name || 'UNK_USER';
        
        const startX = (Math.random() - 0.5) * 2000;
        const startY = (Math.random() - 0.5) * 2000;
        
        const core = Bodies.rectangle(startX, startY, 38, 38, {
            label: 'core',
            plugin: { gridX: 0, gridY: 0 }
        });
        
        player.body = Body.create({
            parts: [core],
            frictionAir: 0.05,
            restitution: 0.5,
            label: 'player_ship'
        });
        
        World.add(engine.world, player.body);
    });

    socket.on('input', (i) => { 
        if (players[socket.id]) {
            const oldInputs = players[socket.id].inputs;
            players[socket.id].inputs = i; 
            if (i.rotate && !oldInputs.rotate) {
                rotateShip(players[socket.id]);
            }
            // Drop Logic (Q)
            if (i.drop && !oldInputs.drop) {
                ejectModule(players[socket.id]);
            }
        }
    });

    socket.on('disconnect', () => {
        if (players[socket.id]) {
            World.remove(engine.world, players[socket.id].body);
            delete players[socket.id];
        }
    });
});

function rotateShip(player) {
    // 1. Rotate basic coordinates
    player.shipStructure = player.shipStructure.map(mod => {
        if (mod.type === 'core') return mod;
        return { ...mod, x: -mod.y, y: mod.x };
    });

    // 2. Consolidate: Ensure everything is connected to core and compact
    const toProcess = [...player.shipStructure.filter(m => m.type !== 'core')];
    toProcess.sort((a, b) => (Math.abs(a.x) + Math.abs(a.y)) - (Math.abs(b.x) + Math.abs(b.y)));

    const finalStructure = [{ x: 0, y: 0, type: 'core' }];
    for (let mod of toProcess) {
        if (hasNeighbor(mod.x, mod.y, finalStructure)) {
            finalStructure.push(mod);
        } else {
            const spot = findNearestSpot(mod.x, mod.y, finalStructure);
            finalStructure.push({ x: spot.x, y: spot.y, type: mod.type });
        }
    }

    player.shipStructure = finalStructure;
    rebuildShip(player);
}

function ejectModule(player) {
    if (player.shipStructure.length <= 1) return;
    const idx = Math.floor(Math.random() * (player.shipStructure.length - 1)) + 1;
    const mod = player.shipStructure.splice(idx, 1)[0];
    dropModule(player.body.position.x + mod.x * 20, player.body.position.y + mod.y * 20, mod.type);
    rebuildShip(player);
}

function hasNeighbor(x, y, structure) {
    return structure.some(m => (Math.abs(m.x - x) === 1 && m.y === y) || (Math.abs(m.y - y) === 1 && m.x === x));
}

function findNearestSpot(targetX, targetY, structure) {
    let bestSpot = { x: 0, y: 1 };
    let minDist = Infinity;
    const neighbors = [{x:1,y:0}, {x:-1,y:0}, {x:0,y:1}, {x:0,y:-1}];
    for (let m of structure) {
        for (let n of neighbors) {
            const nx = m.x + n.x;
            const ny = m.y + n.y;
            if (!structure.some(s => s.x === nx && s.y === ny)) {
                const d = Math.abs(nx - targetX) + Math.abs(ny - targetY);
                if (d < minDist) {
                    minDist = d;
                    bestSpot = { x: nx, y: ny };
                }
            }
        }
    }
    return bestSpot;
}

setInterval(() => {
    Engine.update(engine, 1000 / 60);

    Object.values(players).forEach(player => {
        if (!player.body.parts) return;
        const { body, inputs, shipStructure } = player;
        
        let force = 0.005 + (shipStructure.filter(m => m.type === 'thruster').length * 0.003);
        const torque = 0.05;

        if (inputs.brake) {
            Body.setVelocity(body, { x: body.velocity.x * 0.9, y: body.velocity.y * 0.9 });
            Body.setAngularVelocity(body, body.angularVelocity * 0.9);
            player.isBraking = true;
        } else {
            player.isBraking = false;
        }

        if (inputs.boost && (!player.lastBoost || Date.now() - player.lastBoost > 2000)) {
            player.boostActive = true;
            player.boostStartTime = Date.now();
            player.lastBoost = Date.now();
        }

        if (player.boostActive) {
            if (Date.now() - player.boostStartTime < 500) force *= 4;
            else player.boostActive = false;
        }

        if (inputs.up) Body.applyForce(body, body.position, { x: Math.cos(body.angle) * force, y: Math.sin(body.angle) * force });
        if (inputs.left) Body.setAngularVelocity(body, -torque);
        if (inputs.right) Body.setAngularVelocity(body, torque);

        if (inputs.shoot && Date.now() - player.lastShoot > 400) {
            shipStructure.filter(m => m.type === 'cannon').forEach(m => {
                const angle = body.angle;
                const spawnX = body.position.x + (m.x * 40 * Math.cos(angle)) - (m.y * 40 * Math.sin(angle)) + Math.cos(angle) * 40;
                const spawnY = body.position.y + (m.x * 40 * Math.sin(angle)) + (m.y * 40 * Math.cos(angle)) + Math.sin(angle) * 40;
                
                const p = Bodies.circle(spawnX, spawnY, 5, { 
                    label: 'projectile',
                    frictionAir: 0,
                    restitution: 1
                });
                Body.setVelocity(p, { x: Math.cos(angle) * 15, y: Math.sin(angle) * 15 });
                projectiles.push({ body: p, life: 100 });
                World.add(engine.world, p);
            });
            player.lastShoot = Date.now();
        }
    });

    for (let i = projectiles.length - 1; i >= 0; i--) {
        projectiles[i].life--;
        if (projectiles[i].life <= 0) {
            World.remove(engine.world, projectiles[i].body);
            projectiles.splice(i, 1);
        }
    }

    io.emit('state', {
        players: Object.values(players).filter(p => p.nickname).map(p => ({
            id: p.id,
            nickname: p.nickname,
            position: p.body.position,
            angle: p.body.angle,
            modules: p.shipStructure,
            boostActive: p.boostActive,
            isBraking: p.isBraking
        })),
        modules: modules.map(m => ({ position: m.body.position, type: m.type })),
        projectiles: projectiles.map(p => ({ position: p.body.position })),
        satellites: obstacles.map(o => ({ position: o.position, angle: o.angle }))
    });
}, 1000 / 60);

httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 ENSAMBLADOR.io ejecutándose en el puerto ${PORT}`);
});
