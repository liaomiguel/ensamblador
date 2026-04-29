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

const { Engine, World, Bodies, Body, Events } = Matter;
const engine = Engine.create();
engine.gravity.y = 0;

const players = {};
const mapSize = 3000;
const modules = [];
const moduleTypes = ['thruster', 'cannon', 'shield', 'drill'];
const projectiles = [];
const MAX_MODULES = 120;

// Initial modules
for (let i = 0; i < MAX_MODULES; i++) spawnModule();

// Periodic respawn to keep map alive
setInterval(() => {
    if (modules.length < MAX_MODULES) {
        spawnModule();
    }
}, 2000);

function spawnModule() {
    const type = moduleTypes[Math.floor(Math.random() * moduleTypes.length)];
    const x = Math.random() * mapSize - mapSize / 2;
    const y = Math.random() * mapSize - mapSize / 2;
    const body = Bodies.rectangle(x, y, 30, 30, { label: 'module', isStatic: true, isSensor: true });
    modules.push({ id: Math.random().toString(36).substr(2, 9), type, body });
    World.add(engine.world, body);
}

function rebuildShip(player) {
    const { shipStructure, body: oldBody } = player;
    const parts = shipStructure.map(mod => {
        return Bodies.rectangle(
            oldBody.position.x + (mod.x * 40 * Math.cos(oldBody.angle) - mod.y * 40 * Math.sin(oldBody.angle)),
            oldBody.position.y + (mod.x * 40 * Math.sin(oldBody.angle) + mod.y * 40 * Math.cos(oldBody.angle)),
            40, 40,
            { label: mod.type, frictionAir: 0.05 }
        );
    });

    const velocity = oldBody.velocity;
    const angularVelocity = oldBody.angularVelocity;
    const pos = oldBody.position;
    const angle = oldBody.angle;

    World.remove(engine.world, oldBody);
    player.body = Body.create({ parts, frictionAir: 0.05, restitution: 0.5 });
    Body.setPosition(player.body, pos);
    Body.setAngle(player.body, angle);
    Body.setVelocity(player.body, velocity);
    Body.setAngularVelocity(player.body, angularVelocity);
    World.add(engine.world, player.body);
}

function fireProjectiles(player) {
    player.shipStructure.forEach(mod => {
        if (mod.type === 'cannon') {
            const angle = player.body.angle;
            const x = player.body.position.x + (mod.x * 40 * Math.cos(angle) - mod.y * 40 * Math.sin(angle));
            const y = player.body.position.y + (mod.x * 40 * Math.sin(angle) + mod.y * 40 * Math.cos(angle));
            
            const pBody = Bodies.circle(x, y, 5, { label: 'projectile', frictionAir: 0 });
            pBody.playerId = player.id;
            Body.setVelocity(pBody, {
                x: Math.cos(angle) * 15 + player.body.velocity.x,
                y: Math.sin(angle) * 15 + player.body.velocity.y
            });
            projectiles.push({ body: pBody, id: Math.random() });
            World.add(engine.world, pBody);
            
            Body.applyForce(player.body, { x, y }, {
                x: -Math.cos(angle) * 0.002,
                y: -Math.sin(angle) * 0.002
            });
        }
    });
}

// Tick loop
setInterval(() => {
    Engine.update(engine, 1000 / 60);

    Object.values(players).forEach(player => {
        const { body, inputs, shipStructure } = player;
        const thrusters = shipStructure.filter(m => m.type === 'thruster').length;
        const force = 0.005 + (thrusters * 0.003);
        const torque = 0.05;

        if (inputs.up) Body.applyForce(body, body.position, { x: Math.cos(body.angle) * force, y: Math.sin(body.angle) * force });
        if (inputs.left) Body.setAngularVelocity(body, -torque);
        if (inputs.right) Body.setAngularVelocity(body, torque);
        
        if (inputs.shoot && (!player.lastShoot || Date.now() - player.lastShoot > 300)) {
            fireProjectiles(player);
            player.lastShoot = Date.now();
        }

        // Module pickup
        modules.forEach((mod, i) => {
            if (Math.hypot(body.position.x - mod.body.position.x, body.position.y - mod.body.position.y) < 60) {
                const relX = mod.body.position.x - body.position.x;
                const relY = mod.body.position.y - body.position.y;
                const cos = Math.cos(-body.angle);
                const sin = Math.sin(-body.angle);
                const gx = Math.round((relX * cos - relY * sin) / 40);
                const gy = Math.round((relX * sin + relY * cos) / 40);

                if (!shipStructure.find(m => m.x === gx && m.y === gy)) {
                    shipStructure.push({ type: mod.type, x: gx, y: gy });
                    rebuildShip(player);
                    World.remove(engine.world, mod.body);
                    modules.splice(i, 1);
                    spawnModule(); // Keep map populated
                }
            }
        });
    });

    // Projectile cleanup
    for (let i = projectiles.length - 1; i >= 0; i--) {
        const p = projectiles[i];
        if (Math.abs(p.body.position.x) > mapSize || Math.abs(p.body.position.y) > mapSize) {
            World.remove(engine.world, p.body);
            projectiles.splice(i, 1);
        }
    }

    // State broadcast
    io.emit('state', {
        players: Object.values(players).map(p => ({
            id: p.id,
            nickname: p.nickname,
            position: p.body.position,
            angle: p.body.angle,
            modules: p.shipStructure
        })),
        modules: modules.map(m => ({ position: m.body.position, type: m.type })),
        projectiles: projectiles.map(p => ({ position: p.body.position }))
    });
}, 1000 / 60);

Events.on(engine, 'collisionStart', (event) => {
    event.pairs.forEach(pair => {
        const { bodyA, bodyB } = pair;
        handleHit(bodyA, bodyB);
        handleHit(bodyB, bodyA);
    });
});

function handleHit(bullet, target) {
    if (bullet.label === 'projectile') {
        Object.values(players).forEach(player => {
            const isHit = target === player.body || target.parent === player.body;
            if (isHit && bullet.playerId !== player.id) {
                // Damage: remove last module or core
                if (target.label === 'core') {
                    io.to(player.id).emit('gameover');
                    player.shipStructure = [{ type: 'core', x: 0, y: 0 }];
                    Body.setPosition(player.body, { x: Math.random() * 1000 - 500, y: Math.random() * 1000 - 500 });
                    rebuildShip(player);
                } else {
                    player.shipStructure = player.shipStructure.filter(m => m.type === 'core' || Math.random() > 0.3);
                    rebuildShip(player);
                }
                World.remove(engine.world, bullet);
            }
        });
    }
}

io.on('connection', (socket) => {
    const core = Bodies.rectangle(Math.random() * 1000 - 500, Math.random() * 1000 - 500, 40, 40, { label: 'core' });
    players[socket.id] = {
        id: socket.id,
        nickname: 'Invitado',
        body: core,
        shipStructure: [{ type: 'core', x: 0, y: 0 }],
        inputs: { up: false, left: false, right: false, down: false, shoot: false }
    };
    World.add(engine.world, core);

    socket.on('join', (name) => {
        if (players[socket.id]) {
            players[socket.id].nickname = name || 'Invitado';
        }
    });

    socket.on('input', (i) => { if (players[socket.id]) players[socket.id].inputs = i; });
    socket.on('disconnect', () => {
        if (players[socket.id]) {
            World.remove(engine.world, players[socket.id].body);
            delete players[socket.id];
        }
    });
});

httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 ENSAMBLADOR.io ejecutándose en el puerto ${PORT}`);
});
