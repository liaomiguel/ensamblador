# 🚀 ENSAMBLADOR.io

**ENSAMBLADOR.io** es un simulador de combate espacial multijugador masivo (IO) basado en física. Construye tu nave pieza a pieza, sobrevive a peligros ambientales y domina la arena destruyendo los núcleos de tus oponentes.

![Premium Design](https://img.shields.io/badge/Design-Premium-gold?style=for-the-badge)
![Tech Stack](https://img.shields.io/badge/Stack-Node.js%20%7C%20Socket.io%20%7C%20Matter.js-blue?style=for-the-badge)

## 🎮 El Juego

En un universo de chatarra espacial, eres un **Núcleo** solitario. Tu misión es recolectar módulos para evolucionar tu estructura y convertirte en la fuerza dominante.

### 🛠️ Mecánicas Únicas
- **Ensamblaje Modular:** Las piezas se conectan físicamente a tu nave mediante un sistema de rejilla dinámica.
- **Auto-Reorganización (R):** Un algoritmo inteligente que ordena tus piezas en una formación triangular táctica de combate.
- **Inercia Espacial:** Simulación de levitación constante en gravedad cero.
- **Freno de Emergencia (E):** Control absoluto para maniobras evasivas precisas.
- **Sistema de Daño por Capas:** Protege tu núcleo con escudos y módulos; si el núcleo cae, se acaba el juego.

## 🧱 Tipos de Módulos
- ⚪ **Núcleo:** Tu centro vital. Protégelo a toda costa.
- 🟡 **Taladro:** Arma de contacto letal para embestidas.
- 🔴 **Cañón:** Sistema de defensa y ataque a larga distancia.
- 🟣 **Escudo:** Módulo de alta resistencia y absorción de impactos.
- 🔵 **Propulsor:** Mejora la potencia de empuje y la capacidad de turbo.

## 🌌 Peligros del Entorno
- **Satélites Hexagonales:** Estáticos y masivos. Provocan la pérdida masiva de módulos.
- **Patrullas Triangulares:** Pequeños drones cian que patrullan lentamente. Difíciles de esquivar a alta velocidad.

## 🛠️ Stack Tecnológico
- **Motor de Física:** [Matter.js](https://brm.io/matter-js/) para colisiones y dinámicas de cuerpos rígidos.
- **Comunicación:** [Socket.io](https://socket.io/) para sincronización en tiempo real de baja latencia.
- **Servidor:** Node.js + Express.
- **Cliente:** Vanilla JavaScript con Canvas API (Optimizado con Culling e Interpolación LERP).

## 🚀 Instalación y Ejecución Local

1. Instala las dependencias:
   ```bash
   npm install
   ```
2. Inicia el servidor de desarrollo:
   ```bash
   npm run dev
   ```
3. Abre en tu navegador: `http://localhost:3000`

## ☁️ Despliegue (Fly.io)

Este proyecto está listo para ser desplegado en Fly.io:
```bash
flyctl deploy
```

---
Desarrollado con ❤️ por el equipo de ENSAMBLADOR.io
