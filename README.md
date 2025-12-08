# 🎬 OsiVibe

> Professional video editor in your browser — open source & libre

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Made by Jema Technology](https://img.shields.io/badge/Made%20by-Jema%20Technology-757aed)](https://www.jematechnology.fr/)
[![React](https://img.shields.io/badge/React-18-61dafb.svg)](https://reactjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-3178c6.svg)](https://www.typescriptlang.org/)

---

## 🎯 About

OsiVibe is a modern, browser-based video editor built with performance and accessibility in mind. Designed to work seamlessly across all devices — from foldable smartphones to desktop computers — OsiVibe brings professional video editing capabilities to everyone, everywhere.

**Key Highlights:**
- 🆓 **Open Source & Libre** — Free to use, modify, and distribute
- 🌐 **Browser-Based** — No installation required
- 📱 **Responsive Design** — Optimized for foldable devices, phones, tablets, and desktops
- ⚡ **Hardware-Optimized** — GPU/CPU detection for optimal encoding performance

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| 🎬 **Timeline Editing** | Intuitive drag-and-drop timeline for video arrangement |
| 🎨 **Modern UI** | Clean, dark-themed interface with smooth animations |
| 🔄 **Transitions** | Built-in transition effects between clips |
| 📤 **Export Options** | Multiple format and quality export settings |
| 🖥️ **Hardware Detection** | Automatic GPU/CPU optimization for encoding |
| 📚 **Media Library** | Organized media management system |
| ⚙️ **Properties Panel** | Fine-tune clip properties and effects |

---

## 📱 Supported Devices

OsiVibe features a comprehensive responsive design system optimized for modern devices:

| Category | Devices |
|----------|---------|
| **📱 Foldables** | Galaxy Z Fold 5/6, Honor Magic V3, Oppo Find N3, Pixel Fold |
| **📱 Smartphones** | iPhone 15 Pro Max, iPhone SE, Galaxy S24, Pixel 8 |
| **📲 Tablets** | iPad Pro, iPad Air, iPad Mini, Galaxy Tab |
| **🖥️ Desktop** | All modern browsers (Chrome, Firefox, Safari, Edge) |

### Breakpoints

```
fold-cover: 272px  │  xs: 375px  │  sm: 428px  │  fold-inner: 512px
md: 768px  │  lg: 1024px  │  xl: 1280px  │  2xl: 1536px
```

---

## 🚀 Getting Started

### Prerequisites

- Node.js 18 or higher
- npm or pnpm

### Installation

```bash
# Clone the repository
git clone https://github.com/jematechnology/osivibe.git
cd osivibe

# Install dependencies
npm install

# Start development server
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

---

## 💻 Development

### Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server |
| `npm run build` | Build for production |
| `npm run build:prod` | Build for production (optimized) |
| `npm run preview` | Preview production build |
| `npm run lint` | Run ESLint |

### Project Structure

```
osivibe/
├── public/           # Static assets & PWA files
├── src/
│   ├── components/   # React components
│   ├── hooks/        # Custom React hooks
│   ├── lib/          # Utility libraries
│   ├── store/        # Zustand state management
│   ├── types/        # TypeScript type definitions
│   └── utils/        # Helper functions
└── ...config files
```

---

## 🔧 Tech Stack

| Technology | Purpose |
|------------|---------|
| **React 18** | UI Framework |
| **TypeScript** | Type Safety |
| **Vite** | Build Tool & Dev Server |
| **Tailwind CSS** | Styling |
| **Zustand** | State Management |
| **shadcn/ui** | UI Components |
| **FFmpeg.wasm** | Video Processing |
| **Radix UI** | Accessible Primitives |

---

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 📄 License

MIT License © 2025 [Jema Technology](https://www.jematechnology.fr/)

See [LICENSE](LICENSE) for more information.

---

## 🔗 Links

- **Website:** [jematechnology.fr](https://www.jematechnology.fr/)
- **Issues:** [GitHub Issues](https://github.com/jematechnology/osivibe/issues)

---

<p align="center">
  Made with ❤️ by <a href="https://www.jematechnology.fr/">Jema Technology</a>
</p>
