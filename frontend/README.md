# React Flow Map Editor - Setup Guide

## 🎉 Migration Complete!

Your Fabric.js map editor has been successfully migrated to React Flow. This new implementation provides:

- **90% less custom code** (from 1,687 lines to ~800 lines)
- **Better UX** with professional node editor components
- **Built-in features**: zoom/pan, minimap, smooth connections, drag-to-connect
- **Modern React** architecture with hooks and components
- **Same Flask API** - no backend changes required

## 📋 Prerequisites

You need Node.js and npm installed. Choose one option:

### Option 1: Using Homebrew (Recommended for macOS)
```bash
brew install node
```

### Option 2: Using Node Version Manager (nvm)
```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
nvm install --lts
```

### Option 3: Download from nodejs.org
Visit https://nodejs.org/ and download the LTS version.

## 🚀 Quick Start

### 1. Install Dependencies

```bash
cd /Users/alexandremoulart/Documents/plant-dashboard/frontend
npm install
```

This will install:
- React 18
- React Flow 11
- Axios (for API calls)
- Vite (build tool)

### 2. Development Mode

**Terminal 1 - Start Flask Backend:**
```bash
cd /Users/alexandremoulart/Documents/plant-dashboard
python app.py
```
Flask will run on http://localhost:5000

**Terminal 2 - Start React Dev Server:**
```bash
cd /Users/alexandremoulart/Documents/plant-dashboard/frontend
npm run dev
```
Vite will run on http://localhost:5173

**Open browser:** http://localhost:5173

The Vite dev server will proxy API calls to Flask automatically.

### 3. Production Build

```bash
cd /Users/alexandremoulart/Documents/plant-dashboard/frontend
npm run build
```

This creates `/frontend/dist` with optimized production files.

Then start Flask normally:
```bash
cd /Users/alexandremoulart/Documents/plant-dashboard
python app.py
```

Flask will serve the React build from `/frontend/dist` at http://localhost:5000

## 📁 Project Structure

```
plant-dashboard/
├── frontend/                     # NEW - React app
│   ├── src/
│   │   ├── components/
│   │   │   ├── MapEditor.jsx    # Main editor (React Flow)
│   │   │   ├── nodes/
│   │   │   │   ├── PlantNode.jsx
│   │   │   │   └── WatererNode.jsx
│   │   │   ├── Toolbar.jsx
│   │   │   ├── LeftPanel.jsx
│   │   │   └── PropertiesPanel.jsx
│   │   ├── hooks/
│   │   │   └── useApi.js        # API integration
│   │   ├── App.jsx
│   │   ├── main.jsx
│   │   └── index.css
│   ├── index.html
│   ├── package.json
│   ├── vite.config.js
│   └── dist/                    # Built files (after npm run build)
├── app.py                       # MODIFIED - Serves React build
├── static/                      # OLD Fabric.js files (kept as backup)
└── templates/                   # OLD HTML templates (kept as backup)
```

## ✨ Features

### Custom Node Types
- **Plant Node**: Green circular node with 4 connection handles (N/S/E/W)
- **Waterer Node**: Blue circular node with 4 connection handles

### Drag & Drop
- Drag plant/waterer from left panel onto canvas
- Or click to add at center
- Drag nodes to reposition (auto-saves to backend)

### Connections
- Drag from any handle to another node's handle
- Animated connection lines
- Delete connections by selecting and pressing Delete key

### Properties Panel
- Shows selected object details
- Cluster configuration for waterers connected to 1-3 plants
- Calibration, pairing, watering controls
- All integrated with existing backend API

### Dark Theme
- Matches your VSCode-style dark theme
- Professional, modern UI

## 🔧 Development Tips

### Hot Reload
In development mode, changes to React files trigger instant hot reload - no page refresh needed!

### React DevTools
Install React DevTools browser extension for debugging:
- Chrome: https://chrome.google.com/webstore
- Firefox: https://addons.mozilla.org/en-US/firefox/

### VS Code Extensions
Recommended:
- ES7+ React/Redux/React-Native snippets
- Prettier - Code formatter
- ESLint

## 🐛 Troubleshooting

### Port Already in Use
If port 5173 is busy:
```bash
# Edit frontend/vite.config.js and change port
server: { port: 3000 }
```

### API Calls Failing
Make sure Flask is running on port 5000. Vite proxy is configured for this.

### Build Errors
Clear node_modules and reinstall:
```bash
rm -rf node_modules package-lock.json
npm install
```

## 📚 React Flow Documentation

- Docs: https://reactflow.dev/
- Examples: https://reactflow.dev/examples
- API: https://reactflow.dev/api-reference

## 🎯 Next Steps

1. Install Node.js (see Prerequisites above)
2. Run `npm install` in the frontend directory
3. Test in development mode with both Flask and Vite running
4. Build for production with `npm run build`
5. Deploy! Flask will serve the React build automatically.

Your old Fabric.js files are preserved in `/static` and `/templates` for reference or rollback if needed.

Enjoy your new React Flow editor! 🚀
