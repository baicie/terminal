# Terminal Project - Agent Guidelines

## Project Overview

This is a **Tauri-based terminal application** that provides SSH/SFTP connectivity with a modern UI. It combines a React frontend with a Rust backend.

### Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend Framework | React 19 + TypeScript |
| Build Tool | Vite 8.x |
| UI Library | Ant Design 6.x |
| Terminal Emulator | xterm.js |
| State Management | MobX |
| Dependency Injection | tsyringe |
| Styling | UnoCSS + Sass |
| i18n | i18next (en, fr, cn) |
| Backend | Tauri 2.x (Rust) |
| SSH/SFTP | russh |
| Database | SQLite (tauri-plugin-sql) |

---

## Project Structure

```
terminal/
├── src/                          # Frontend source code
│   ├── view/                     # Page components
│   │   ├── terminal/             # Terminal view
│   │   ├── sftp/                 # SFTP view
│   │   └── vaults/               # Vaults/connections view
│   ├── layout/                   # Layout components
│   ├── hooks/                    # Custom React hooks
│   ├── store/                    # MobX stores
│   ├── service/                  # API services
│   ├── utils/                    # Utilities (logger, axios)
│   ├── locales/                  # i18n translations
│   │   ├── en/
│   │   ├── fr/
│   │   └── cn/
│   ├── router/                   # React Router config
│   ├── di.ts                     # DI container setup
│   └── App.tsx                   # Root component
├── src-tauri/                    # Rust backend
│   ├── src/
│   │   ├── lib.rs                # Library entry
│   │   ├── main.rs               # Binary entry
│   │   └── terminal.rs           # SSH terminal logic
│   ├── Cargo.toml                # Rust dependencies
│   ├── tauri.conf.json           # Tauri configuration
│   └── capabilities/             # Tauri capabilities
└── package.json                  # Node dependencies
```

---

## Key Conventions

### Frontend (React/TypeScript)

1. **Path Aliases**: Use `@/` for imports from `src/` directory
   ```typescript
   import { useTerminal } from '@/hooks/use-terminal';
   import { AppStore } from '@/store/app';
   ```

2. **Dependency Injection**: Use tsyringe for dependency injection
   ```typescript
   @injectable()
   class MyService {
     // ...
   }
   ```

3. **State Management**: Use MobX for reactive state
   ```typescript
   class AppStore {
     @observable count = 0;
     @action increment() { this.count++; }
   }
   ```

4. **i18n**: Use `react-i18next` for internationalization
   ```typescript
   const { t } = useTranslation();
   return <div>{t('common.save')}</div>;
   ```

5. **Styling**: Prefer UnoCSS utility classes, use Sass for complex styles

### Backend (Rust)

1. **Tauri Commands**: Expose Rust functions to frontend via `#[tauri::command]`

2. **Async**: Use `tokio` for async runtime

3. **Error Handling**: Use `anyhow` for error handling

---

## Common Tasks

### Running the Application

```bash
# Frontend only
pnpm dev

# Full Tauri app
pnpm tauri dev

# Build for production
pnpm tauri build
```

### Adding a New Dependency

**Frontend (npm):**
```bash
pnpm add <package-name>
```

**Backend (Rust):**
Edit `src-tauri/Cargo.toml` and run `cargo update`

### Database

The app uses SQLite via `tauri-plugin-sql`. Database operations are done from the frontend using the SQL plugin API.

---

## Current Known Issues

1. **russh API Compatibility**: The SSH code in `src-tauri/src/terminal.rs` uses an older russh API. The code needs to be updated to be compatible with russh 0.57.1.

---

## Useful Links

- [Tauri 2.x Docs](https://tauri.app/)
- [React 19 Docs](https://react.dev/)
- [Ant Design](https://ant.design/)
- [xterm.js](https://xtermjs.org/)
- [russh](https://github.com/warpdotdev/russh)
