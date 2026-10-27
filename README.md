<div align="center">

<h1>🎬 OsiVibe</h1>

### Professional video editing, right in your browser

[![Made by Jema Technology](https://img.shields.io/badge/Made%20by-Jema%20Technology-8286ef)](https://www.jematechnology.fr)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![React](https://img.shields.io/badge/React-18-61dafb?logo=react&logoColor=white)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Vite](https://img.shields.io/badge/Vite-6-646cff?logo=vite&logoColor=white)](https://vitejs.dev)
[![TailwindCSS](https://img.shields.io/badge/Tailwind-3-38bdf8?logo=tailwindcss&logoColor=white)](https://tailwindcss.com)
[![PWA](https://img.shields.io/badge/PWA-Offline%20Ready-8286ef)](#-supported-devices)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](#-contributing)

**Timeline editing · transitions · effects · text · hardware-accelerated export** — no installation, no upload.

[Features](#-features) · [Screenshots](#-screenshots) · [Getting started](#-getting-started) · [Tech stack](#-tech-stack) · [License](#-license)

<br>

<sub>**Keywords:** online video editor · browser video editor · timeline editing · video transitions · video effects · text & titles · video export · MP4 · WebM · media library · hardware-accelerated encoding · MediaBunny · no install · no upload · responsive · PWA · React · TypeScript · TailwindCSS</sub>

</div>

![OsiVibe — video editor](screenshots/main.png)

---

## 🎯 About

OsiVibe is a modern, browser-based video editor built for performance and accessibility. It runs seamlessly from foldable phones to desktop computers, bringing professional editing to everyone, everywhere.

## ✨ Features

| Feature | Description |
| --- | --- |
| 🎬 **Timeline editing** | Intuitive drag-and-drop timeline for arranging clips |
| 🎨 **Modern UI** | Clean, dark-themed interface with smooth animations |
| 🔄 **Transitions** | Built-in transition effects between clips |
| 🔤 **Text & titles** | Add captions and titles on top of your video |
| ✨ **Effects** | Fine-tune clip properties, filters and effects |
| 📤 **Export** | Multiple formats and quality presets |
| 🖥️ **Hardware detection** | Automatic GPU/CPU optimization for encoding |
| 📚 **Media library** | Organized media management (video, audio, images) |
| ⚡ **Media Bunny engine** | Instant media loading and zero-latency playback |

**Key highlights:** free & open source, browser-based (no install), fully responsive, installable as a PWA.

---

## 📸 Screenshots

### Interface

| Light | Dark |
| :---: | :---: |
| <img src="screenshots/main.png" alt="OsiVibe — light" /> | <img src="screenshots/main-dark.png" alt="OsiVibe — dark" /> |

### Editing tools

| 🔤 Text & titles | 🔄 Transitions |
| :---: | :---: |
| <img src="screenshots/text.png" alt="OsiVibe — add captions and titles" /> | <img src="screenshots/transition.png" alt="OsiVibe — transitions between clips" /> |

| ✨ Effects | 📤 Export |
| :---: | :---: |
| <img src="screenshots/effects.png" alt="OsiVibe — filters and effects" /> | <img src="screenshots/export.png" alt="OsiVibe — export dialog with presets" /> |

### 📱 Mobile

| Dark | Light |
| :---: | :---: |
| <img src="screenshots/mobile-dark.png" alt="OsiVibe — mobile, dark" width="300" /> | <img src="screenshots/mobile-light.png" alt="OsiVibe — mobile, light" width="300" /> |

---

## 📱 Supported devices

OsiVibe ships a comprehensive responsive system built for modern devices:

| Category | Devices |
| --- | --- |
| **Foldables** | Galaxy Z Fold 5/6, Honor Magic V3, Oppo Find N3, Pixel Fold |
| **Smartphones** | iPhone 15 Pro Max, iPhone SE, Galaxy S24, Pixel 8 |
| **Tablets** | iPad Pro/Air/Mini, Galaxy Tab |
| **Desktop** | Chrome, Firefox, Safari, Edge |

Breakpoints:

```
fold-cover: 272px │ xs: 375px │ sm: 428px │ fold-inner: 512px
md: 768px │ lg: 1024px │ xl: 1280px │ 2xl: 1536px
```

---

## 🚀 Getting started

### Prerequisites

- [Node.js](https://nodejs.org) 18+
- npm

### Development

```bash
git clone https://github.com/JemaOS/osivibe.git
cd osivibe
npm install
npm run dev
```

### Build & preview

```bash
npm run build       # production build
npm run preview     # preview locally
```

### Tests

```bash
npm test            # unit tests (Vitest)
npm run test:e2e    # end-to-end tests (Playwright)
```

---

## 🔧 Tech stack

- **React 18** + **TypeScript**
- **Vite** build tooling
- **TailwindCSS** styling
- **Zustand** state management
- **Media Bunny** + **FFmpeg WASM** for decoding/encoding
- **Vitest** + **Playwright** for tests

---

## 🤝 Contributing

Contributions are welcome! Fork, branch, and open a pull request.

```bash
git checkout -b feat/my-feature
git commit -m "feat: my feature"
git push origin feat/my-feature
```

---

## 📄 License

Released under the **MIT License** — see [LICENSE](LICENSE).

<div align="center">
Made with ❤️ by <a href="https://www.jematechnology.fr">Jema Technology</a>
</div>
