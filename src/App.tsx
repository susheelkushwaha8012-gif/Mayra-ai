import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Mic, MicOff, Phone, Mail, Globe, MessageCircle , Settings, X, Upload, Trash2 } from 'lucide-react';
import { pcmToBase64 } from './lib/audioUtils';
import { PCMPlayer } from './pcm-player';

type UIState = 'idle' | 'listening' | 'thinking' | 'speaking';
type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

// A simple permissions screen for the web to act as the "Permissions Onboarding"
function PermissionsScreen({ onGranted }: { onGranted: () => void }) {
  const [granted, setGranted] = useState(false);

  const requestPermissions = async () => {
    try {
      // Check for Android Bridge for permissions
      if (typeof (window as any).ToolExecutionEngine !== 'undefined' && (window as any).ToolExecutionEngine.requestPermissions) {
         try {
           (window as any).ToolExecutionEngine.requestPermissions(JSON.stringify([
              "android.permission.RECORD_AUDIO",
              "android.permission.POST_NOTIFICATIONS",
              "android.permission.READ_CONTACTS",
              "android.permission.CALL_PHONE"
           ]));
         } catch(e) {
           console.error(e);
         }
      } else {
        // Fallback for Web
        if (typeof Notification !== 'undefined') {
          await Notification.requestPermission();
        }
      }
      
      // Always request getUserMedia in web view to capture audio stream for WebRTC/WebSockets
      await navigator.mediaDevices.getUserMedia({ audio: true });
      setGranted(true);
      setTimeout(onGranted, 500);
    } catch (err) {
      alert("Microphone permission is required to speak with Zoya. Please check your settings.");
    }
  };

  return (
    <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center p-6 text-center font-sans">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-md w-full bg-zinc-900/50 backdrop-blur-xl p-8 rounded-3xl border border-zinc-800"
      >
        <div className="w-16 h-16 bg-purple-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
          <Mic className="text-purple-400 w-8 h-8" />
        </div>
        <h1 className="text-3xl font-light mb-2 text-zinc-100">Welcome to Zoya</h1>
        <p className="text-zinc-400 mb-8 font-light">
          Your sassy, real-time AI assistant. To begin, Zoya needs access to your microphone.
        </p>
        
        <div className="space-y-4 mb-8 text-left text-sm text-zinc-500">
          <div className="flex items-center gap-3">
             <div className="w-2 h-2 rounded-full bg-purple-500"></div>
             <span>Microphone (For voice chat)</span>
          </div>
          <div className="flex items-center gap-3">
             <div className="w-2 h-2 rounded-full bg-blue-500"></div>
             <span>Device Actions (Simulated via intents)</span>
          </div>
        </div>

        <button 
          onClick={requestPermissions}
          className={`w-full py-4 rounded-xl font-medium transition-all duration-300 ${granted ? 'bg-green-500 text-black' : 'bg-white text-black hover:bg-zinc-200'}`}
        >
          {granted ? "Permissions Granted" : "Grant Permissions"}
        </button>
      </motion.div>
    </div>
  );
}

// Fix Chrome GC bug by holding references to utterances
const activeUtterances = new Set<SpeechSynthesisUtterance>();

export default function App() {
  const [deviceId] = useState(() => {
    let id = localStorage.getItem('deviceId');
    if (!id) {
      id = 'device-' + Math.random().toString(36).substring(2, 15);
      localStorage.setItem('deviceId', id);
    }
    return id;
  });

  const [dbMemories, setDbMemories] = useState<any[]>([]);

  
  const [girlfriendMode, setGirlfriendMode] = useState<boolean>(false);
  const [wallpaper, setWallpaper] = useState<string | null>(null);
  const [language, setLanguage] = useState<string>('hi-IN');
  const [showSettings, setShowSettings] = useState(false);
  const [memories, setMemories] = useState<string[]>([]);

  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const reconnectPendingRef = useRef<boolean>(false);
  const isSyncedRef = useRef<boolean>(false);

  useEffect(() => {
    const syncData = async () => {
      try {
        const res = await fetch('/api/user', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deviceId })
        });
        if (res.ok) {
          const data = await res.json();
          if (data.settings) {
            setGirlfriendMode(data.settings.girlfriend_mode);
            setWallpaper(data.settings.wallpaper);
            setLanguage(data.settings.language || 'hi-IN');
          }
          if (data.memories) {
            setDbMemories(data.memories);
            setMemories(data.memories.map((m: any) => m.memory));
          }
        }
      } catch (err) {
        console.error("Failed to sync with DB", err);
      } finally {
        isSyncedRef.current = true;
      }
    };
    syncData();
  }, [deviceId]);

  // Handle setting updates to DB
  useEffect(() => {
    if (!isSyncedRef.current) return;
    const updateSettings = async () => {
      try {
        await fetch('/api/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deviceId, settings: { girlfriend_mode: girlfriendMode, wallpaper, language } })
        });
      } catch(e) {}
    };
    updateSettings();
  }, [girlfriendMode, wallpaper, language, deviceId]);


  

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

  const [permissionsGranted, setPermissionsGranted] = useState(false);
  const [connState, setConnState] = useState<ConnectionState>('disconnected');
  const [uiState, setUiState] = useState<UIState>('idle');
  
  const wsRef = useRef<WebSocket | null>(null);
  const inputAudioCtxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const pcmPlayerRef = useRef<PCMPlayer | null>(null);
  
  const textBufferRef = useRef<string>("");
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [lastAction, setLastAction] = useState<string>('');

  useEffect(() => {
    const loadVoices = () => setVoices(window.speechSynthesis.getVoices());
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
  }, []);

  const speakSentence = (text: string) => {
    if (!text.trim()) return;
    const utterance = new SpeechSynthesisUtterance(text);
    activeUtterances.add(utterance);
    
    const availableVoices = window.speechSynthesis.getVoices();
    let selectedVoice = availableVoices.find(v => v.lang.includes('hi') && v.name.toLowerCase().includes('female'));
    if (!selectedVoice) {
      selectedVoice = availableVoices.find(v => v.lang.includes('en') && v.name.toLowerCase().includes('female'));
    }
    if (!selectedVoice) {
      selectedVoice = availableVoices.find(v => v.lang.includes('hi'));
    }
    if (!selectedVoice) {
      selectedVoice = availableVoices.find(v => v.lang.includes('en'));
    }
    
    if (selectedVoice) {
      utterance.voice = selectedVoice;
    } else if (availableVoices.length > 0) {
      console.warn("No Hindi or English female voice found. Using default.");
      setLastAction("Warning: Using default voice (female voice not found).");
    }
    
    utterance.onstart = () => {
      console.log("TTS Start:", text);
      setUiState('speaking');
    };
    utterance.onerror = (e) => {
      console.error("TTS Error:", e.error);
      activeUtterances.delete(utterance);
      setUiState('idle');
    };
    utterance.onend = () => {
      console.log("TTS End:", text);
      activeUtterances.delete(utterance);
      if (!window.speechSynthesis.speaking && !window.speechSynthesis.pending) {
        setUiState('idle');
      }
    };
    
    window.speechSynthesis.speak(utterance);
  };

  const connectToZoya = async () => {
    setConnState('connecting');
    try {
      // Unlock Speech API on interaction
      const unlockUtterance = new SpeechSynthesisUtterance("");
      unlockUtterance.volume = 0;
      window.speechSynthesis.speak(unlockUtterance);

      
      const wsUrl = `wss://${window.location.host}/live`;
      const ws = new WebSocket(window.location.protocol === "https:" ? wsUrl : `ws://${window.location.host}/live`);
      wsRef.current = ws;

      ws.onopen = async () => {
        setConnState('connected');
        
        ws.send(JSON.stringify({ type: 'init', girlfriendMode, memories }));
        
        // Setup Audio Contexts
        const inputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
        inputAudioCtxRef.current = inputCtx;
        
        pcmPlayerRef.current = new PCMPlayer(24000);

        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        streamRef.current = stream;
        
        const source = inputCtx.createMediaStreamSource(stream);
        const processor = inputCtx.createScriptProcessor(4096, 1, 1);
        processorRef.current = processor;
        
        source.connect(processor);
        processor.connect(inputCtx.destination);
        
        processor.onaudioprocess = (e) => {
          if (ws.readyState === WebSocket.OPEN) {
            const base64 = pcmToBase64(e.inputBuffer.getChannelData(0));
            ws.send(JSON.stringify({ audio: base64 }));
          }
        };
      };

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        
        if (msg.type === 'error') {
           console.error("Server Error:", msg.message);
           setConnState('error');
           setLastAction(`Error: ${msg.message}`);
           wsRef.current = null; // Prevent auto-reconnect on fatal errors
           ws.close();
           return;
        }

        if (msg.type === 'info') {
           console.log("Server Info:", msg.message);
           setLastAction(msg.message);
           setTimeout(() => setLastAction(''), 8000);
           return;
        }
        
        if (msg.type === 'audio') {
           pcmPlayerRef.current?.play(msg.data);
           setUiState('speaking');
        }

        if (msg.type === 'text') {
           textBufferRef.current += msg.text;
           // Extract all complete sentences
           while (true) {
             const match = textBufferRef.current.match(/^([^.!?]*[.!?]+)(.*)$/s);
             if (match) {
               const sentence = match[1].trim();
               textBufferRef.current = match[2] || "";
               // Only use TTS if we didn't receive PCM audio (pcmPlayer is fallback or concurrent if wanted, but Gemini usually sends one or the other. We'll disable TTS if we want pure audio, or let both play if we're debugging. Let's just log it or rely on PCM)
               if (sentence.length > 0) {
                 // speakSentence(sentence); // Disabled in favor of Gemini PCM audio
                 console.log("Gemini:", sentence);
                 fetch('/api/conversations', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ deviceId, role: 'assistant', content: sentence })
                 }).catch(()=>console.error('Failed to save convo'));
               }
             } else {
               break;
             }
           }
        }
        
        if (msg.type === 'turnComplete') {
           if (reconnectPendingRef.current) {
              reconnectPendingRef.current = false;
              // Give it a second to finish speaking before reconnecting
              setTimeout(() => {
                if (wsRef.current !== null) {
                   disconnect();
                   setTimeout(connectToZoya, 500);
                }
              }, 2000);
           }
           if (textBufferRef.current.trim().length > 0) {
              // speakSentence(textBufferRef.current.trim());
              console.log("Gemini:", textBufferRef.current.trim());
              fetch('/api/conversations', {
                 method: 'POST',
                 headers: { 'Content-Type': 'application/json' },
                 body: JSON.stringify({ deviceId, role: 'assistant', content: textBufferRef.current.trim() })
              }).catch(()=>console.error('Failed to save convo'));
              textBufferRef.current = "";
           }
           // We might want to set uiState to idle when audio finishes, PCMPlayer can handle that
        }
        
        if (msg.type === 'interrupted') {
           setUiState('idle');
           window.speechSynthesis.cancel();
           pcmPlayerRef.current?.stop();
           textBufferRef.current = "";
        }

        if (msg.type === 'toolCall') {
           handleToolCall(msg.name, msg.args);
        }
      };

      ws.onclose = () => {
        setConnState('disconnected');
        cleanupAudio();
        // Auto-reconnect if it wasn't an intentional disconnect
        if (wsRef.current !== null) {
          setTimeout(connectToZoya, 3000);
        }
      };
      
      ws.onerror = (err) => {
        console.error("WebSocket Error:", err);
        setConnState('error');
        // Will trigger onclose and attempt reconnect
      };

    } catch (err) {
      console.error(err);
      setConnState('error');
    }
  };

  const cleanupAudio = () => {
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (inputAudioCtxRef.current) {
      inputAudioCtxRef.current.close();
      inputAudioCtxRef.current = null;
    }
    window.speechSynthesis.cancel();
  };

  const handleToolCall = (name: string, args: any) => {
    console.log("Tool call:", name, args);
    let actionDesc = "";
    
    // Check if running inside an Android WebView with ToolExecutionEngine injected
    if (typeof (window as any).ToolExecutionEngine !== 'undefined') {
      try {
        (window as any).ToolExecutionEngine.executeTool(name, JSON.stringify(args));
        setLastAction(`Native: ${name}`);
        setTimeout(() => setLastAction(''), 5000);
        return;
      } catch (err) {
        console.error("Native ToolExecutionEngine failed", err);
      }
    }
    
    // Fallback to web implementation
    if (name === "saveMemory") {
      actionDesc = `Saved memory: ${args.memory}`;
      setLastAction(actionDesc);
      
      // Save to DB
      fetch('/api/memories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId, memory: args.memory })
      }).then(res => res.json()).then(data => {
        if(data.success && data.memory) {
          setDbMemories(prev => [...prev, data.memory]);
          setMemories(prev => [...prev, data.memory.memory]);
        }
      });
      return;
    } else if (name === "setGirlfriendMode") {
      actionDesc = `Girlfriend Mode ${args.enable ? 'ON' : 'OFF'}`;
      setLastAction(actionDesc);
      setGirlfriendMode(args.enable);
      
      reconnectPendingRef.current = true;
      return;
    } else if (name === "openApp") {
      const appName = args.packageName || args.appName || "App";
      actionDesc = `Opening ${appName}`;
      setLastAction(actionDesc);
      const appLower = appName.toLowerCase();
      if (appLower.includes('youtube')) window.open('https://youtube.com', '_blank');
      else if (appLower.includes('instagram')) window.open('https://instagram.com', '_blank');
      else if (appLower.includes('telegram')) window.open('https://web.telegram.org', '_blank');
      else if (appLower.includes('whatsapp')) window.open('https://web.whatsapp.com', '_blank');
      else if (appLower.includes('chrome')) window.open('https://google.com', '_blank');
      else if (appLower.includes('gmail')) window.open('https://mail.google.com', '_blank');
      else if (appLower.includes('maps')) window.open('https://maps.google.com', '_blank');
      else if (appLower.includes('spotify')) window.open('https://open.spotify.com', '_blank');
      else if (appLower.includes('facebook')) window.open('https://facebook.com', '_blank');
      else if (appLower.includes('twitter') || appLower.includes(' x')) window.open('https://x.com', '_blank');
      else if (appLower.includes('snapchat')) window.open('https://snapchat.com', '_blank');
      else if (appLower.includes('netflix')) window.open('https://netflix.com', '_blank');
      else if (appLower.includes('amazon')) window.open('https://amazon.com', '_blank');
      else if (appLower.includes('flipkart')) window.open('https://flipkart.com', '_blank');
      else if (appLower.includes('chatgpt') || appLower.includes('openai')) window.open('https://chatgpt.com', '_blank');
      else if (appLower.includes('play store') || appLower.includes('playstore')) window.open('https://play.google.com', '_blank');
      else if (appLower.includes('calendar')) window.open('https://calendar.google.com', '_blank');
      else if (appLower.includes('calculator')) setLastAction('Opening Calculator (Native action triggered)');
      else if (appLower.includes('settings')) setLastAction('Opening Settings (Native action triggered)');
      else if (appLower.includes('camera')) setLastAction('Opening Camera (Native action triggered)');
      else if (appLower.includes('gallery') || appLower.includes('photos')) setLastAction('Opening Gallery (Native action triggered)');
      else if (appLower.includes('contacts')) setLastAction('Opening Contacts (Native action triggered)');
      else if (appLower.includes('phone')) window.open('tel:', '_blank');
      else if (appLower.includes('files')) setLastAction('Opening Files (Native action triggered)');
      else window.open(`https://www.google.com/search?q=${encodeURIComponent(appName)}`, '_blank');
    } else if (name === "mediaControl") {
      const action = args.action || "play";
      actionDesc = `Media Action: ${action}`;
      setLastAction(actionDesc);
      if (pcmPlayerRef.current) {
        if (action === "pause" || action === "stop") pcmPlayerRef.current.stop();
        if (action === "mute") pcmPlayerRef.current.stop();
      }
    } else if (name === "searchPlayStore") {
      actionDesc = `Searching Play Store for: ${args.query}`;
      setLastAction(actionDesc);
      window.open(`https://play.google.com/store/search?q=${encodeURIComponent(args.query)}&c=apps`, '_blank');
    } else if (name === "searchContacts") {
      actionDesc = `Searching contacts: ${args.query}`;
      setLastAction(actionDesc);
    } else if (name === "searchFiles") {
      actionDesc = `Searching files: ${args.query}`;
      setLastAction(actionDesc);
    } else if (name === "searchPhotos") {
      actionDesc = `Searching photos: ${args.query}`;
      setLastAction(actionDesc);
    } else if (name === "searchGoogle") {
      actionDesc = `Searching Google for: ${args.query}`;
      setLastAction(actionDesc);
      window.open(`https://www.google.com/search?q=${encodeURIComponent(args.query)}`, '_blank');
    } else if (name === "searchYouTube") {
      actionDesc = `Searching YouTube for: ${args.query}`;
      setLastAction(actionDesc);
      window.open(`https://www.youtube.com/results?search_query=${encodeURIComponent(args.query)}`, '_blank');
    } else if (name === "callContact") {
      actionDesc = `Calling ${args.contactName}`;
      setLastAction(actionDesc);
      window.open(`tel:${encodeURIComponent(args.contactName)}`, '_blank');
    } else if (name === "sendWhatsAppMessage") {
      actionDesc = `WhatsApp ${args.contactName}: ${args.message}`;
      setLastAction(actionDesc);
      window.open(`https://wa.me/?text=${encodeURIComponent(args.message)}`, '_blank');
    } else if (name === "sendGmail") {
      actionDesc = `Sending email to ${args.recipientEmail || 'someone'}`;
      setLastAction(actionDesc);
      const mailto = `mailto:${args.recipientEmail || ''}?subject=${encodeURIComponent(args.subject || '')}&body=${encodeURIComponent(args.body || '')}`;
      window.open(mailto, '_blank');
    } else {
      actionDesc = `Executed ${name}`;
      setLastAction(actionDesc);
    }
    
    // Provide vocal feedback (Optional, using TTS)
    if (actionDesc) {
      // speakSentence(actionDesc);
    }
    
    setTimeout(() => setLastAction(''), 5000);
  };

  const disconnect = () => {
    if (wsRef.current) {
      const ws = wsRef.current;
      wsRef.current = null; // Clear ref before closing to signal intentional disconnect
      ws.close();
    }
    setConnState('disconnected');
    setUiState('idle');
  };

  if (!permissionsGranted) {
    return <PermissionsScreen onGranted={() => setPermissionsGranted(true)} />;
  }

  // Determine orb styling based on state
  const getOrbState = () => {
    if (connState !== 'connected') return { scale: 1, opacity: 0.5, color: '#3f3f46', shadow: '0px 0px 0px rgba(0,0,0,0)' };
    
    switch (uiState) {
      case 'speaking':
        return { 
          scale: [1, 1.15, 1], 
          opacity: 1, 
          color: '#a855f7', 
          shadow: '0px 0px 60px rgba(168,85,247,0.6)',
          transition: { repeat: Infinity, duration: 0.5 }
        };
      case 'listening':
        return { 
          scale: [1, 1.05, 1], 
          opacity: 0.8, 
          color: '#3b82f6', 
          shadow: '0px 0px 30px rgba(59,130,246,0.4)',
          transition: { repeat: Infinity, duration: 1.5 }
        };
      case 'idle':
      default:
        return { 
          scale: [1, 1.02, 1], 
          opacity: 0.7, 
          color: '#d4d4d8', 
          shadow: '0px 0px 15px rgba(212,212,216,0.1)',
          transition: { repeat: Infinity, duration: 3 }
        };
    }
  };

  const orbStyle = getOrbState();

  return (
    <div className="min-h-screen bg-[#050505] text-white flex flex-col items-center justify-center font-sans overflow-hidden relative" style={wallpaper ? { backgroundImage: `url(${wallpaper})`, backgroundSize: 'cover', backgroundPosition: 'center' } : {}}>
      {/* Overlay to ensure text readability if wallpaper is bright */}
      {wallpaper && <div className="absolute inset-0 bg-black/40 z-0 pointer-events-none"></div>}

      {/* Settings Button */}
      <div className="absolute top-6 right-6 z-50">
        <button 
          onClick={() => setShowSettings(true)}
          className="p-3 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur-md border border-white/20 transition-all text-white shadow-lg"
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
              className="bg-zinc-900 border border-white/10 rounded-3xl w-full max-w-md overflow-hidden shadow-2xl relative"
            >
              <div className="p-6 border-b border-white/10 flex justify-between items-center bg-white/5">
                <h2 className="text-xl font-medium tracking-wide">Settings</h2>
                <button onClick={() => setShowSettings(false)} className="p-2 rounded-full hover:bg-white/10 text-zinc-400 hover:text-white transition-colors">
                  <X size={20} />
                </button>
              </div>
              
              <div className="p-6 space-y-8">
                {/* Girlfriend Mode Toggle */}
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-medium text-white mb-1">Girlfriend Mode</h3>
                    <p className="text-sm text-zinc-400">Warmer, natural companion AI</p>
                  </div>
                  <button 
                    onClick={() => {
                       const newMode = !girlfriendMode;
                       setGirlfriendMode(newMode);
                       if (connState === 'connected') {
                          reconnectPendingRef.current = false; // Reset it just in case
                          disconnect();
                          setTimeout(connectToZoya, 500);
                       }
                    }}
                    className={`w-14 h-8 rounded-full flex items-center p-1 transition-colors ${girlfriendMode ? 'bg-pink-500' : 'bg-zinc-700'}`}
                  >
                    <motion.div 
                      layout
                      className="w-6 h-6 bg-white rounded-full shadow-md"
                      animate={{ x: girlfriendMode ? 24 : 0 }}
                      transition={{ type: "spring", stiffness: 500, damping: 30 }}
                    />
                  </button>
                </div>
                
                {/* Memory Settings */}
                <div className="mb-6">
                  <h3 className="text-lg font-medium text-white mb-3">Memories</h3>
                  <div className="bg-black/30 rounded-xl p-4 max-h-48 overflow-y-auto">
                    {memories.length === 0 ? (
                      <p className="text-zinc-500 text-sm italic">No memories saved yet.</p>
                    ) : (
                      <ul className="space-y-2">
                        {memories.map((mem, idx) => (
                          <li key={idx} className="flex items-start justify-between gap-2 text-sm text-zinc-300 border-b border-white/5 pb-2 last:border-0">
                            <span>{mem}</span>
                            <button 
                              onClick={() => {
                                const dbMem = dbMemories[idx];
                                if (dbMem) {
                                  fetch(`/api/memories/${dbMem.id}`, { method: 'DELETE' });
                                  const newDb = [...dbMemories];
                                  newDb.splice(idx, 1);
                                  setDbMemories(newDb);
                                }
                                const newMem = [...memories];
                                newMem.splice(idx, 1);
                                setMemories(newMem);
                              }}
                              className="text-zinc-500 hover:text-red-400 p-1 rounded transition-colors"
                            >
                              <Trash2 size={14} />
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
                
                {/* Language Settings */}
                <div className="mb-6">
                  <h3 className="text-lg font-medium text-white mb-3">Language</h3>
                  <select 
                    value={language}
                    onChange={(e) => setLanguage(e.target.value)}
                    className="w-full py-3 px-4 bg-white/10 hover:bg-white/20 rounded-xl transition-colors border border-white/5 text-white outline-none"
                  >
                    <option value="hi-IN" className="bg-zinc-800">Hindi (India)</option>
                    <option value="en-US" className="bg-zinc-800">English (US)</option>
                    <option value="en-IN" className="bg-zinc-800">English (India)</option>
                  </select>
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
                  <div className="flex items-center gap-2 text-sm text-zinc-400">
                    <div className={`w-2 h-2 rounded-full ${girlfriendMode ? 'bg-pink-500' : 'bg-zinc-500'}`}></div>
                    <span>Status: {girlfriendMode ? 'Girlfriend Mode ON' : 'Girlfriend Mode OFF'}</span>
                  </div>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      
      {/* Background ambient glow */}
      <div 
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[80vh] h-[80vh] rounded-full blur-[120px] pointer-events-none opacity-20 transition-all duration-1000"
        style={{ backgroundColor: orbStyle.color as string }}
      />

      {/* Main Orb */}
      <div className="relative z-10 flex flex-col items-center justify-center h-[60vh]">
        <motion.div
          animate={{
            scale: orbStyle.scale,
            boxShadow: orbStyle.shadow,
            borderColor: orbStyle.color
          }}
          transition={orbStyle.transition as any}
          className="w-48 h-48 sm:w-64 sm:h-64 rounded-full border-[2px] bg-black/50 backdrop-blur-md flex items-center justify-center cursor-pointer relative"
          onClick={connState === 'connected' ? disconnect : connectToZoya}
        >
          {/* Inner core */}
          <motion.div 
             animate={{ backgroundColor: orbStyle.color }}
             className="absolute w-full h-full rounded-full opacity-10 blur-xl"
          />
          
          {connState === 'connected' ? (
            <Mic className="w-12 h-12 text-white/80 z-20" />
          ) : (
            <MicOff className="w-12 h-12 text-white/40 z-20" />
          )}
        </motion.div>
        
        {/* Connection text */}
        <div className="mt-12 text-center h-12">
          {connState === 'disconnected' && (
             <p className="text-zinc-500 font-light tracking-wide">Tap to wake Zoya</p>
          )}
          {connState === 'connecting' && (
             <p className="text-purple-400 font-light animate-pulse tracking-wide">Connecting...</p>
          )}
          {connState === 'connected' && (
             <div className="flex flex-col items-center gap-2">
                <p className="text-zinc-300 font-light tracking-widest uppercase text-sm">
                  {uiState === 'idle' ? 'Listening' : uiState === 'speaking' ? 'Speaking' : 'Listening'}
                </p>
             </div>
          )}
          {connState === 'error' && (
             <div className="flex flex-col items-center gap-2">
                <p className="text-red-400 font-light tracking-wide">Connection Failed</p>
             </div>
          )}
        </div>
      </div>

      {/* Action Toast */}
      <AnimatePresence>
        {lastAction && (
          <motion.div 
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className={`absolute bottom-24 backdrop-blur-lg px-6 py-3 rounded-full border text-sm flex items-center gap-3 ${
              lastAction.startsWith('Error:') 
                ? 'bg-red-900/80 border-red-700 text-red-100' 
                : 'bg-zinc-800/80 border-zinc-700'
            }`}
          >
            {!lastAction.startsWith('Error:') && <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />}
            {lastAction}
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
}
