# 🚀 ENSAMBLADOR.io

**ENSAMBLADOR.io** es un juego multijugador masivo en tiempo real inspirado en *Agar.io*, pero con un enfoque en la **ingeniería espacial y el combate modular**. Aquí no ganas por ser el más grande, sino por tener el mejor diseño.

![Aesthetic Preview](https://img.shields.io/badge/Aesthetics-Cyberpunk-blueviolet?style=for-the-badge)
![Physics](https://img.shields.io/badge/Physics-Matter.js-00f2ff?style=for-the-badge)
![Tech](https://img.shields.io/badge/Tech-Socket.io-ffffff?style=for-the-badge)

## 🌌 El Concepto

Empiezas como un simple **Núcleo (Core)** flotando en el vacío. Tu objetivo es recoger **Chatarra Espacial** (módulos) para expandir tu nave y proteger tu núcleo a toda costa. Si destruyen tu núcleo, pierdes.

### 🛠️ Tipos de Módulos
| Módulo | Función | Ventaja |
| :--- | :--- | :--- |
| **Propulsor** | Aumenta la velocidad | Escapes rápidos y maniobrabilidad. |
| **Cañón** | Dispara proyectiles | Ataque a distancia (genera retroceso). |
| **Escudo** | Bloquea impactos | Alta resistencia a disparos. |
| **Taladro** | Daño por contacto | Destroza naves enemigas de cerca. |

## 🎮 Controles
- **WASD / Flechas**: Moverse y rotar.
- **ESPACIO**: Disparar (si tienes cañones).
- **RATÓN**: Apuntar (la cámara te sigue).

## 🛠️ Tecnologías Utilizadas

- **Frontend**: HTML5 Canvas, Vanilla JavaScript, CSS3 (Glassmorphism).
- **Backend**: Node.js, Express.
- **Física**: [Matter.js](https://brm.io/matter-js/) (Simulación en el servidor).
- **Comunicación**: [Socket.io](https://socket.io/) (Tiempo real).

## 🚀 Instalación y Ejecución Local

1.  **Clonar el repositorio**:
    ```bash
    git clone <tu-repo>
    cd laserio
    ```
2.  **Instalar dependencias**:
    ```bash
    npm install
    ```
3.  **Ejecutar en desarrollo**:
    ```bash
    npm run dev
    ```
4.  Abrir `http://localhost:3000` en tu navegador.

## 🚢 Despliegue en Railway

Este proyecto está listo para ser alojado en [Railway.app](https://railway.app/). Solo conecta tu repositorio de GitHub y Railway detectará automáticamente el comando de inicio.

---
Desarrollado con ❤️ por Antigravity.
