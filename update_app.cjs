const fs = require('fs');
let content = fs.readFileSync('src/App.tsx', 'utf8');

// 1. Add imports if needed. We need Settings icon.
content = content.replace(/import \{.*?\} from 'lucide-react';/, (match) => {
    return match.replace("}", ", Settings, X, Upload }");
});

// 2. Add state
const stateReplacement = `
  const [girlfriendMode, setGirlfriendMode] = useState<boolean>(() => {
    return localStorage.getItem('girlfriendMode') === 'true';
  });
  const [wallpaper, setWallpaper] = useState<string | null>(() => {
    return localStorage.getItem('wallpaper') || null;
  });
  const [showSettings, setShowSettings] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    localStorage.setItem('girlfriendMode', String(girlfriendMode));
  }, [girlfriendMode]);

  useEffect(() => {
    if (wallpaper) {
      localStorage.setItem('wallpaper', wallpaper);
    } else {
      localStorage.removeItem('wallpaper');
    }
  }, [wallpaper]);

  const handleWallpaperUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        setWallpaper(event.target?.result as string);
      };
      reader.readAsDataURL(file);
    }
  };
`;
content = content.replace(/const \[permissionsGranted, setPermissionsGranted\] = useState\(false\);/, stateReplacement + '\n  const [permissionsGranted, setPermissionsGranted] = useState(false);');

// 3. Update WebSocket URL
content = content.replace(/const wsUrl = \`wss:\/\/\$\{window\.location\.host\}\/live\`;/, 'const wsUrl = `wss://${window.location.host}/live?girlfriendMode=${girlfriendMode}`;');
content = content.replace(/const ws = new WebSocket\(window\.location\.protocol === 'https:' \? wsUrl : \`ws:\/\/\$\{window\.location\.host\}\/live\`\);/, 'const ws = new WebSocket(window.location.protocol === "https:" ? wsUrl : `ws://${window.location.host}/live?girlfriendMode=${girlfriendMode}`);');

// 4. Update handleToolCall
const handleToolCallRegex = /if \(name === "openApp"\) \{/;
const handleToolCallReplacement = `if (name === "setGirlfriendMode") {
      actionDesc = \`Girlfriend Mode \${args.enable ? 'ON' : 'OFF'}\`;
      setLastAction(actionDesc);
      setGirlfriendMode(args.enable);
      
      // Need to reconnect to apply new instruction
      cleanupAudio();
      setTimeout(connectToZoya, 500);
      return;
    } else if (name === "openApp") {`;
content = content.replace(handleToolCallRegex, handleToolCallReplacement);

// 5. Update UI
// Find the main container
const mainContainerRegex = /<div className="min-h-screen bg-neutral-900 text-neutral-100 flex flex-col relative overflow-hidden">/;
const newMainContainer = `<div className="min-h-screen bg-neutral-900 text-neutral-100 flex flex-col relative overflow-hidden" style={wallpaper ? { backgroundImage: \`url(\${wallpaper})\`, backgroundSize: 'cover', backgroundPosition: 'center' } : {}}>
      {/* Overlay to ensure text readability if wallpaper is bright */}
      {wallpaper && <div className="absolute inset-0 bg-black/40 z-0"></div>}

      {/* Settings Button */}
      <div className="absolute top-6 right-6 z-20">
        <button 
          onClick={() => setShowSettings(true)}
          className="p-3 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur-md border border-white/20 transition-all text-white"
        >
          <Settings size={24} />
        </button>
      </div>

      {/* Settings Modal */}
      <AnimatePresence>
        {showSettings && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
          >
            <motion.div 
              initial={{ y: 50, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 50, opacity: 0 }}
              className="bg-neutral-900 border border-white/10 rounded-3xl w-full max-w-md overflow-hidden shadow-2xl relative"
            >
              <div className="p-6 border-b border-white/10 flex justify-between items-center bg-white/5">
                <h2 className="text-xl font-medium tracking-wide">Settings</h2>
                <button onClick={() => setShowSettings(false)} className="p-2 rounded-full hover:bg-white/10 text-neutral-400 hover:text-white transition-colors">
                  <X size={20} />
                </button>
              </div>
              
              <div className="p-6 space-y-8">
                {/* Girlfriend Mode Toggle */}
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-medium text-white mb-1">Girlfriend Mode</h3>
                    <p className="text-sm text-neutral-400">Warmer, natural companion AI</p>
                  </div>
                  <button 
                    onClick={() => {
                       setGirlfriendMode(!girlfriendMode);
                       // Reconnect if currently connected
                       if (connState === 'connected') {
                          cleanupAudio();
                          setTimeout(connectToZoya, 500);
                       }
                    }}
                    className={\`w-14 h-8 rounded-full flex items-center p-1 transition-colors \${girlfriendMode ? 'bg-pink-500' : 'bg-neutral-700'}\`}
                  >
                    <motion.div 
                      layout
                      className="w-6 h-6 bg-white rounded-full shadow-md"
                      animate={{ x: girlfriendMode ? 24 : 0 }}
                      transition={{ type: "spring", stiffness: 500, damping: 30 }}
                    />
                  </button>
                </div>
                
                {/* Wallpaper Settings */}
                <div>
                  <h3 className="text-lg font-medium text-white mb-3">Wallpaper</h3>
                  <div className="flex flex-col gap-3">
                    <button 
                      onClick={() => fileInputRef.current?.click()}
                      className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-white/10 hover:bg-white/20 rounded-xl transition-colors border border-white/5"
                    >
                      <Upload size={18} />
                      <span>Upload from Gallery</span>
                    </button>
                    <input 
                      type="file" 
                      ref={fileInputRef} 
                      onChange={handleWallpaperUpload} 
                      accept="image/*" 
                      className="hidden" 
                    />
                    
                    {wallpaper && (
                      <button 
                        onClick={() => setWallpaper(null)}
                        className="w-full py-3 px-4 bg-red-500/10 text-red-400 hover:bg-red-500/20 rounded-xl transition-colors border border-red-500/20"
                      >
                        Reset to Default
                      </button>
                    )}
                  </div>
                </div>
                
                {/* Status indicator */}
                <div className="pt-4 border-t border-white/10">
                  <div className="flex items-center gap-2 text-sm text-neutral-400">
                    <div className={\`w-2 h-2 rounded-full \${girlfriendMode ? 'bg-pink-500' : 'bg-neutral-500'}\`}></div>
                    <span>Status: {girlfriendMode ? 'Girlfriend Mode ON' : 'Girlfriend Mode OFF'}</span>
                  </div>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
`;

content = content.replace(mainContainerRegex, newMainContainer);

fs.writeFileSync('src/App.tsx', content);
