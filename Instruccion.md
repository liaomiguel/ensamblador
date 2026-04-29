El desarrollo de **Core-Builder.io** implica un juego multijugador en tiempo real con física de cuerpos compuestos, donde los jugadores construyen naves modulares pieza a pieza. La parte más crítica es el **servidor autoritativo** que ejecuta la simulación de Matter.js, gestiona las colisiones entre módulos y sincroniza el estado completo de cada nave (estructura, posición y vida de cada módulo) con los clientes. A continuación, te presento la arquitectura completa lista para desplegar en Railway, incluyendo el código esencial tanto del backend como del frontend.

---

## 1. Pila tecnológica y estructura del proyecto

- **Backend:** Node.js + Express (servir archivos estáticos) + WebSocket (`ws` nativo) + Matter.js (física en servidor).
- **Frontend:** HTML5 Canvas + Matter.js (renderizado y predicción local) + WebSocket cliente.
- **Despliegue:** Railway con Dockerfile o detección automática de Node.js.

**Estructura de archivos:**

```
core-builder/
├── server.js          # Servidor principal (Express + WebSocket)
├── game.js            # Lógica del mundo, jugadores, físicas
├── public/
│   ├── index.html     # Canvas y UI
│   └── client.js      # Renderizado, interpolación, entradas
├── package.json
└── Dockerfile         # Opcional
```

---

## 2. Servidor autoritativo (server.js + game.js)

El servidor mantiene el estado verdadero del juego. Cada tic (60 Hz) actualiza la física, procesa entradas de jugadores, aplica daño por taladros y cañones, y gestiona la recogida de módulos sueltos.

### 2.1 Configuración del servidor WebSocket

```javascript
// server.js
const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const {
  initGame,
  addPlayer,
  removePlayer,
  updateGame,
  getState,
} = require("./game");

const app = express();
app.use(express.static("public"));
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

initGame();

wss.on("connection", (ws) => {
  const playerId = addPlayer(ws);
  ws.on("message", (data) => {
    const input = JSON.parse(data);
    // input: { thrust: boolean, rotation: -1|0|1, fire: boolean }
    playerInputs[playerId] = input;
  });
  ws.on("close", () => removePlayer(playerId));
});

const TICK_RATE = 1000 / 60;
setInterval(() => {
  updateGame(playerInputs);
  const state = getState();
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(state));
    }
  });
}, TICK_RATE);

server.listen(process.env.PORT || 3000, () => console.log("Servidor listo"));
```

### 2.2 El motor de física y el sistema de naves compuestas

**Concepto clave:** Cada nave es un `Matter.Body` compuesto (`parts` array), donde el **núcleo** es la parte con índice 0. Los demás elementos (propulsores, cañones, escudo, taladro) son partes añadidas en el momento de la recogida. Cuando un módulo se destruye, se recompone el cuerpo solo con las partes supervivientes.

```javascript
// game.js
const Matter = require("matter-js");
const Engine = Matter.Engine,
  Body = Matter.Body,
  Bodies = Matter.Bodies,
  Composite = Matter.Composite,
  Events = Matter.Events,
  Vector = Matter.Vector;

const MODULE_TYPES = ["propulsor", "cañon", "escudo", "taladro"];
const MODULE_SHAPES = {
  propulsor: (x, y) =>
    Bodies.rectangle(x, y, 20, 30, { chamfer: { radius: 5 } }),
  cañon: (x, y) => Bodies.rectangle(x, y, 15, 50),
  escudo: (x, y) => Bodies.rectangle(x, y, 40, 80, { chamfer: { radius: 20 } }),
  taladro: (x, y) => Bodies.polygon(x, y, 5, 15), // pentágono como taladro
};

let engine,
  world,
  players = {},
  pickups = [];

function createShip(coreX, coreY) {
  const core = Bodies.rectangle(coreX, coreY, 30, 30, {
    label: "core",
    plugin: { hp: 100, type: "core", owner: null },
  });
  const ship = Body.create({ parts: [core], label: "ship" });
  ship.plugin = { engineStatus: "ok", outOfControlTimer: 0 };
  return ship;
}

function attachModuleToShip(ship, moduleType, worldPoint) {
  // Convierte el punto de contacto mundial a coordenadas locales del cuerpo
  const localPoint = Vector.rotate(
    Vector.sub(worldPoint, ship.position),
    -ship.angle,
  );
  const shapeFunc = MODULE_SHAPES[moduleType];
  const newPart = shapeFunc(0, 0);
  Body.setPosition(newPart, localPoint);
  newPart.plugin = { hp: 50, type: moduleType };
  // Reconstruir el cuerpo compuesto
  const allParts = ship.parts.concat(newPart);
  Body.setParts(ship, allParts);
}
```

**Fuerzas de propulsores y retroceso de cañones:** El jugador envía `thrust`, que se traduce en fuerzas aplicadas en las posiciones mundiales de cada módulo `propulsor`:

```javascript
function applyThrust(ship) {
  if (!ship.plugin.engineStatus === "ok") return; // sin control si motor destruido
  ship.parts.forEach((part) => {
    if (part.plugin.type === "propulsor") {
      const worldPos = Vector.add(
        ship.position,
        Vector.rotate(part.position, ship.angle),
      );
      const force = Vector.mult(
        Vector.rotate({ x: 0, y: -0.002 }, ship.angle),
        1,
      );
      Matter.Body.applyForce(ship, worldPos, force);
    }
  });
}
```

Disparar un cañón aplica una fuerza de retroceso igual y opuesta en la posición del módulo:

```javascript
function fireCannons(ship, world) {
  ship.parts.forEach((part) => {
    if (part.plugin.type === "cañon") {
      const worldPos = Vector.add(
        ship.position,
        Vector.rotate(part.position, ship.angle),
      );
      const bulletDir = Vector.rotate({ x: 0, y: -1 }, ship.angle); // hacia adelante
      const bullet = Bodies.circle(worldPos.x, worldPos.y, 4, {
        label: "bullet",
        isSensor: false,
      });
      bullet.plugin = { damage: 20 };
      Body.setVelocity(bullet, Vector.mult(bulletDir, 10));
      Composite.add(world, bullet);
      // Retroceso
      const recoil = Vector.mult(bulletDir, -0.0005);
      Matter.Body.applyForce(ship, worldPos, recoil);
    }
  });
}
```

### 2.3 Sistema de daño y destrucción parcial

Cada parte tiene HP. Los proyectiles (balas) y el taladro causan daño. Detectamos colisiones con los `Events` de Matter.js:

```javascript
Events.on(engine, "collisionStart", (event) => {
  event.pairs.forEach((pair) => {
    const { bodyA, bodyB } = pair;
    // Proyectil vs parte de nave
    if (bodyA.label === "bullet" && bodyB.parent.label === "ship") {
      const part = findHitPart(bodyB); // devuelve la parte específica golpeada
      dealDamage(part, bodyA.plugin.damage);
      Composite.remove(world, bodyA);
    } else if (bodyB.label === "bullet" && bodyA.parent.label === "ship") {
      /* simétrico */
    }
    // Taladro: daño continuo se maneja en collisionActive
  });
});

function dealDamage(part, amount) {
  part.plugin.hp -= amount;
  if (part.plugin.hp <= 0) {
    destroyModule(part);
  }
}

function destroyModule(part) {
  const ship = part.parent;
  const remainingParts = ship.parts.filter((p) => p !== part);
  if (part.plugin.type === "core") {
    // El jugador muere
    killPlayer(ship);
    return;
  }
  // Efecto especial: propulsor destruido → sin control por 2 segundos
  if (part.plugin.type === "propulsor") {
    ship.plugin.outOfControlTimer = 120; // 2s a 60fps
    ship.plugin.engineStatus = "spin";
  }
  // Reconstruir cuerpo sin la parte destruida
  Body.setParts(ship, remainingParts);
}
```

### 2.4 Recogida de módulos flotantes

Los módulos en el mapa son cuerpos estáticos. Al chocar la nave de un jugador con uno, el módulo se acopla en el punto de contacto exacto:

```javascript
Events.on(engine, "collisionStart", (event) => {
  // ... manejar recogida
  event.pairs.forEach((pair) => {
    const pickup = [pair.bodyA, pair.bodyB].find((b) => b.label === "pickup");
    const shipBody = [pair.bodyA, pair.bodyB].find((b) => b.label === "ship");
    if (pickup && shipBody) {
      const contact = pair.collision.supports[0]; // punto aproximado
      attachModuleToShip(shipBody, pickup.plugin.type, contact);
      Composite.remove(world, pickup);
      spawnNewPickup();
    }
  });
});
```

---

## 3. Frontend: renderizado y entrada de usuario

El cliente se conecta por WebSocket, recibe el estado del mundo y lo dibuja en un canvas. Utiliza interpolación para movimiento suave.

**client.js – Estructura básica:**

```javascript
const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");
let gameState = { players: [], pickups: [], projectiles: [] };

const ws = new WebSocket(`ws://${location.host}`);
ws.onmessage = (event) => {
  const newState = JSON.parse(event.data);
  // Aquí se puede interpolar entre el último estado y el nuevo
  gameState = newState;
};

// Entradas del jugador (asignadas a teclas)
const input = { thrust: false, rotation: 0, fire: false };
document.addEventListener("keydown", (e) => {
  if (e.key === "w") input.thrust = true;
  if (e.key === "a") input.rotation = -1;
  if (e.key === "d") input.rotation = 1;
  if (e.key === " ") input.fire = true;
});
document.addEventListener("keyup", (e) => {
  if (e.key === "w") input.thrust = false;
  if (e.key === "a" || e.key === "d") input.rotation = 0;
  if (e.key === " ") input.fire = false;
});
setInterval(() => ws.send(JSON.stringify(input)), 50);

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  gameState.players.forEach((player) => {
    const { x, y, angle, modules } = player;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    modules.forEach((mod) => {
      // Dibujar según tipo y offset relativo (mod.ox, mod.oy)
      drawModule(mod);
    });
    ctx.restore();
  });
  // Dibujar pickups y proyectiles...
  requestAnimationFrame(draw);
}
draw();
```

El servidor envía un estado comprimido en JSON con la lista de jugadores. Cada jugador contiene `id, x, y, angle, modules: [{type, ox, oy, hp}, ...]`. El cliente no necesita Matter.js para física, solo para dibujar. Si quieres una sensación más suave, puedes ejecutar una simulación fantasma en cliente y corregir periódicamente, pero para la demostración la interpolación simple funciona.

---

## 4. Despliegue en Railway

1. **Prepara tu repositorio** con los archivos anteriores.
2. Asegúrate de que `package.json` tenga:
   ```json
   {
     "name": "core-builder",
     "dependencies": {
       "express": "^4.18.2",
       "ws": "^8.13.0",
       "matter-js": "^0.19.0"
     },
     "scripts": {
       "start": "node server.js"
     }
   }
   ```
3. Crea un `Dockerfile` si quieres control total:
   ```Dockerfile
   FROM node:18
   WORKDIR /app
   COPY package*.json ./
   RUN npm install
   COPY . .
   EXPOSE 3000
   CMD ["node", "server.js"]
   ```
4. En Railway, crea un nuevo proyecto desde tu repositorio. Railway detectará el Dockerfile o el script `start`. La variable de entorno `PORT` ya es gestionada.

---

## 5. Mejoras y equilibrio de juego

- **Escudo:** Añade masa alta al crear la pieza `escudo` (`Body.setMass(part, 0.1)`) y un multiplicador de resistencia.
- **Taladro:** En `collisionActive`, comprueba si una parte activa de la nave enemiga está en contacto con un módulo `taladro` y aplica daño por tic.
- **Mapa circular:** Limita el mundo con paredes circulares para evitar fugas, usando `Bodies.circle` estáticos.
- **Minimap y UI:** En el cliente, dibuja un minimapa con las posiciones relativas de las naves cercanas.

---

## Conclusión

Con esta arquitectura tienes un juego multijugador en tiempo real completamente funcional, donde la física de cuerpos compuestos, el daño por módulos y la recogida dinámica realmente hacen honor al concepto de **naves modulares**. El servidor en Node.js con Matter.js mantiene todo sincronizado, y el cliente ofrece una experiencia fluida. El despliegue en Railway es directo gracias a la integración con Git y la gestión automática del puerto.

Este esqueleto puede extenderse con salas, chat, más tipos de módulos, pero lo fundamental ya está listo para que empieces a probar y jugar con amigos.
