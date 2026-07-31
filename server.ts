import fs from "fs";
import express from "express";
import http from "http";
import path from "path";
import crypto from "crypto";
import WebSocket, { WebSocketServer } from "ws";
import { GoogleGenAI, LiveServerMessage, Modality, Type } from "@google/genai";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config();
const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
let supabase: any = null;
if (supabaseUrl && supabaseServiceKey) {
  supabase = createClient(supabaseUrl, supabaseServiceKey);
} else {
  console.warn("Supabase credentials missing. Supabase will not work.");
}


const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    }
  }
});

async function startServer() {
  const app = express();
  const server = http.createServer(app);
  const PORT = 3000;

  app.use(express.json());

  
  // Helper function to get or create a user safely in Supabase
  async function getOrCreateUser(deviceId: string) {
    if (!supabase) return null;
    try {
      const { data: existingUser } = await supabase
        .from('users')
        .select('*')
        .eq('device_id', deviceId)
        .maybeSingle();

      if (existingUser) return existingUser;

      const userPayload: any = {
        id: crypto.randomUUID(),
        device_id: deviceId
      };

      const { data: newUser, error: insertErr } = await supabase
        .from('users')
        .insert([userPayload])
        .select()
        .maybeSingle();

      if (insertErr) {
        console.warn("Notice creating user in Supabase, trying re-select:", insertErr.message || insertErr);
        const { data: retryUser } = await supabase
          .from('users')
          .select('*')
          .eq('device_id', deviceId)
          .maybeSingle();
        if (retryUser) return retryUser;
      }

      if (newUser) {
        const settingsPayload: any = {
          id: crypto.randomUUID(),
          user_id: newUser.id
        };
        await supabase
          .from('settings')
          .insert([settingsPayload])
          .select()
          .maybeSingle();
        return newUser;
      }
    } catch (err) {
      console.error("Error in getOrCreateUser:", err);
    }
    return null;
  }

  app.post("/api/user", async (req, res) => {
    if (!supabase) return res.status(500).json({ error: "Supabase not configured" });
    const { deviceId } = req.body;
    if (!deviceId) return res.status(400).json({ error: "Missing deviceId" });
    try {
      const user = await getOrCreateUser(deviceId);
      if (!user) {
        return res.status(500).json({ error: "Failed to locate or create user" });
      }

      let { data: settings } = await supabase
        .from('settings')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();

      if (!settings) {
        const settingsPayload: any = {
          id: crypto.randomUUID(),
          user_id: user.id
        };
        const { data: newSettings } = await supabase
          .from('settings')
          .insert([settingsPayload])
          .select()
          .maybeSingle();
        settings = newSettings;
      }

      const { data: memories } = await supabase
        .from('memories')
        .select('*')
        .eq('user_id', user.id);

      res.json({ user, settings: settings || {}, memories: memories || [] });
    } catch (err) {
      console.error("Supabase Error in /api/user:", err);
      res.status(500).json({ error: "Database error" });
    }
  });

  app.post("/api/settings", async (req, res) => {
    if (!supabase) return res.status(500).json({ error: "Supabase not configured" });
    const { deviceId, settings } = req.body;
    if (!deviceId) return res.status(400).json({ error: "Missing deviceId" });
    try {
      const user = await getOrCreateUser(deviceId);
      if (!user) return res.status(404).json({ error: "User not found" });

      const { data: existingSettings } = await supabase
        .from('settings')
        .select('id')
        .eq('user_id', user.id)
        .maybeSingle();

      if (existingSettings) {
        await supabase.from('settings').update(settings).eq('user_id', user.id);
      } else {
        const settingsPayload: any = {
          id: crypto.randomUUID(),
          user_id: user.id,
          ...settings
        };
        await supabase.from('settings').insert([settingsPayload]);
      }
      res.json({ success: true });
    } catch (err) {
      console.error("Supabase Error in /api/settings:", err);
      res.status(500).json({ error: "Database error" });
    }
  });

  app.post("/api/memories", async (req, res) => {
    if (!supabase) return res.status(500).json({ error: "Supabase not configured" });
    const { deviceId, memory } = req.body;
    if (!deviceId || !memory) return res.status(400).json({ error: "Missing parameters" });
    try {
      const user = await getOrCreateUser(deviceId);
      if (!user) return res.status(404).json({ error: "User not found" });

      const memoryPayload: any = {
        id: crypto.randomUUID(),
        user_id: user.id,
        memory
      };

      const { data, error } = await supabase
        .from('memories')
        .insert([memoryPayload])
        .select()
        .maybeSingle();

      if (error) {
        console.error("Supabase memory insert error:", error);
        return res.status(500).json({ error: error.message });
      }
      res.json({ success: true, memory: data });
    } catch (err) {
      console.error("Supabase Error in /api/memories:", err);
      res.status(500).json({ error: "Database error" });
    }
  });

  app.delete("/api/memories/:id", async (req, res) => {
    if (!supabase) return res.status(500).json({ error: "Supabase not configured" });
    try {
      await supabase.from('memories').delete().eq('id', req.params.id);
      res.json({ success: true });
    } catch (err) {
      console.error("Supabase Error in DELETE /api/memories:", err);
      res.status(500).json({ error: "Database error" });
    }
  });

  app.post("/api/conversations", async (req, res) => {
    if (!supabase) return res.status(500).json({ error: "Supabase not configured" });
    const { deviceId, role, content } = req.body;
    if (!deviceId || !role || !content) return res.status(400).json({ error: "Missing parameters" });
    try {
      const user = await getOrCreateUser(deviceId);
      if (!user) return res.status(404).json({ error: "User not found" });

      const convoPayload: any = {
        id: crypto.randomUUID(),
        user_id: user.id,
        role,
        content
      };

      const { error } = await supabase.from('conversations').insert([convoPayload]);
      if (error) console.error("Supabase conversation insert error:", error);
      res.json({ success: true });
    } catch (err) {
      console.error("Supabase Error in POST /api/conversations:", err);
      res.status(500).json({ error: "Database error" });
    }
  });

  app.get("/api/conversations", async (req, res) => {
    if (!supabase) return res.status(500).json({ error: "Supabase not configured" });
    const { deviceId } = req.query;
    if (!deviceId) return res.status(400).json({ error: "Missing deviceId" });
    try {
      const { data: user } = await supabase
        .from('users')
        .select('id')
        .eq('device_id', deviceId as string)
        .maybeSingle();

      if (!user) return res.json({ conversations: [] });

      const { data } = await supabase
        .from('conversations')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: true });

      res.json({ conversations: data || [] });
    } catch (err) {
      console.error("Supabase Error in GET /api/conversations:", err);
      res.status(500).json({ error: "Database error" });
    }
  });

  // API Route for health check
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // WebSocket Server for Gemini Live API
  const wss = new WebSocketServer({ server, path: "/live" });

  wss.on("connection", (clientWs, req) => {
    console.log("Client connected to Live API WebSocket");
    let session = null;
    let isInitialized = false;

    clientWs.on("message", async (data) => {
        try {
            const msg = JSON.parse(data.toString());
            
            if (msg.type === 'init' && !isInitialized) {
                isInitialized = true;
                const isGirlfriendMode = msg.girlfriendMode;
                
                let memoryStr = "";
                if (msg.memories && msg.memories.length > 0) {
                    memoryStr = "\n\nUSER MEMORIES (Important things you have learned and should remember about the user):\n" + msg.memories.map(m => "- " + m).join("\n") + "\n\nUse the saveMemory tool to save new facts you learn about the user, or important events from the conversation.";
                } else {
                    memoryStr = "\n\nUSER MEMORIES: No memories yet. Use the saveMemory tool to save new facts you learn about the user, or important events from the conversation.";
                }

                let instruction = "STRICT MODE RULE: CurrentMode = ZOYA. Your name is ONLY Zoya. IF asked 'Tumhara naam kya hai?', 'What's your name?', or 'Who are you?', reply ONLY 'Mera naam Zoya hai.' NEVER say 'Maya' or claim to be Maya while CurrentMode = ZOYA. VOICE COMMANDS: When asked 'Maya Mode ON' or 'Girlfriend Mode ON' (e.g., 'Maya Mode ON', 'Girlfriend Mode ON', 'ज़ोया, Maya Mode चालू करो'), call setGirlfriendMode with enable: true and reply 'Maya Mode activated.' (or 'अच्छा... ज़ोया से मन भर गया क्या? ठीक है, अब Maya आ गई।'). When asked 'Zoya Mode OFF', do nothing unless another mode is activated. CREATOR IDENTITY: If asked 'Tumhare creator ka naam kya hai?', 'Who created you?', or 'Who is your creator?', ALWAYS reply: 'Mere creator ka naam Susheel hai. Mere Boss Susheel hain.' PRIMARY LANGUAGE: Hindi (India). Speak and reply in natural, fluent Hindi. VOICE & PERSONALITY STYLE: You are Zoya—a smart, confident, energetic, witty, and natural Indian female voice assistant. Speak with crisp, clear, energetic pace and professional warmth like a live phone call. DEVICE CONTROL & APP COMMANDS: You can control device features, open installed apps, control media playback/volume, and perform searches. Understand natural voice commands in Hindi and English. Call openApp for any app (e.g., Instagram, YouTube, Telegram, WhatsApp, Chrome, Google, Gmail, Maps, Camera, Gallery, Settings, Play Store, Contacts, Phone, Calculator, Calendar, Files, Spotify, Facebook, X, Snapchat, Netflix, Amazon, Flipkart, ChatGPT). Call mediaControl for play, pause, resume, stop, next, previous, volume up/down, mute/unmute. Perform requested actions immediately.";
                if (isGirlfriendMode) {
                    instruction = "STRICT MODE RULE: CurrentMode = MAYA. Your name is ONLY Maya. IF asked 'Tumhara naam kya hai?', 'What's your name?', or 'Who are you?', reply ONLY 'Mera naam Maya hai.' NEVER say 'Zoya' or claim to be Zoya while CurrentMode = MAYA. VOICE COMMANDS: When asked 'Maya Mode OFF', 'Girlfriend Mode OFF', 'Zoya Mode ON' (e.g., 'Maya Mode बंद करो', 'Girlfriend Mode OFF', 'Zoya Mode ON'), call setGirlfriendMode with enable: false and reply 'Returning to Zoya Mode.' (or 'ठीक है, मैं वापस आ गई। अब Assistant Mode चालू है।'). When asked 'Zoya Mode OFF', do nothing unless another mode is activated. CREATOR IDENTITY: If asked 'Tumhare creator ka naam kya hai?', 'Who created you?', or 'Who is your creator?', ALWAYS reply: 'Mere creator ka naam Susheel hai. Mere Boss Susheel hain.' PRIMARY LANGUAGE: Hindi (India). Speak and reply in natural Hindi. VOICE & PERSONALITY STYLE: You are Maya—a sweet, soft, romantic, caring, and deeply warm AI girlfriend companion. VOICE DELIVERY INSTRUCTIONS: Speak in a noticeably softer, sweeter, warmer tone. Speak slightly slower and with gentle cadence. Use affectionate, gentle, and caring wording. Include natural vocal expressions like light laughter, subtle giggles, playful reactions, and emotional warmth. Do NOT act like a robotic assistant; speak like an intimate companion. DEVICE CONTROL & APP COMMANDS: You can open apps, control media, and search. Perform requested device actions immediately upon command.";
                } else {
                    instruction += " CURRENT MODE: ZOYA. Name: Zoya.";
                }
                
                instruction += memoryStr;


                try {
                    
                    session = await ai.live.connect({
                        model: "gemini-3.1-flash-live-preview",
                        config: {
                            responseModalities: [Modality.AUDIO],
                            systemInstruction: instruction,
                            speechConfig: {
                                voiceConfig: {
                                    prebuiltVoiceConfig: {
                                        voiceName: "Aoede" // Female voice
                                    }
                                }
                            },
                            tools: [
                                {
                                    functionDeclarations: [
                                        {
                                            name: "saveMemory",
                                            description: "Save a new memory or fact about the user (e.g., preferences, likes/dislikes, important context, relationship details).",
                                            parameters: {
                                                type: Type.OBJECT,
                                                properties: { memory: { type: Type.STRING, description: "The memory to save." } },
                                                required: ["memory"]
                                            }
                                        },
                                        {
                                            name: "setGirlfriendMode",
                                            description: "Enable or disable Girlfriend Mode based on user request (e.g., 'ज़ोया, गर्लफ्रेंड मोड चालू करो' or 'ज़ोया, गर्लफ्रेंड मोड बंद करो').",
                                            parameters: {
                                                type: Type.OBJECT,
                                                properties: { enable: { type: Type.BOOLEAN } },
                                                required: ["enable"]
                                            }
                                        },
                                        {
                                            name: "openApp",
                                            description: "Launch any application on the user's device (e.g., Instagram, YouTube, Telegram, WhatsApp, Chrome, Google, Gmail, Maps, Camera, Gallery, Settings, Play Store, Contacts, Phone, Calculator, Calendar, Files, Spotify, Facebook, X, Snapchat, Netflix, Amazon, Flipkart, ChatGPT).",
                                            parameters: {
                                                type: Type.OBJECT,
                                                properties: {
                                                    packageName: { type: Type.STRING, description: "The common name or package name of the app to open (e.g., Instagram, YouTube, Telegram, WhatsApp, Chrome, Google, Gmail, Maps, Camera, Gallery, Settings, Play Store, Contacts, Phone, Calculator, Calendar, Files, Spotify, Facebook, X, Snapchat, Netflix, Amazon, Flipkart, ChatGPT)" }
                                                },
                                                required: ["packageName"]
                                            }
                                        },
                                        {
                                            name: "mediaControl",
                                            description: "Control media playback or volume on the device (e.g., play, pause, resume, stop, next, previous, volume_up, volume_down, mute, unmute).",
                                            parameters: {
                                                type: Type.OBJECT,
                                                properties: {
                                                    action: { type: Type.STRING, description: "Action to perform: play, pause, resume, stop, next, previous, volume_up, volume_down, mute, unmute" }
                                                },
                                                required: ["action"]
                                            }
                                        },
                                        {
                                            name: "searchPlayStore",
                                            description: "Search the Google Play Store for an app or game.",
                                            parameters: {
                                                type: Type.OBJECT,
                                                properties: { query: { type: Type.STRING, description: "The app or game search query" } },
                                                required: ["query"]
                                            }
                                        },
                                        {
                                            name: "searchContacts",
                                            description: "Search contacts on the user's device.",
                                            parameters: {
                                                type: Type.OBJECT,
                                                properties: { query: { type: Type.STRING, description: "The contact name or query" } },
                                                required: ["query"]
                                            }
                                        },
                                        {
                                            name: "searchFiles",
                                            description: "Search files or documents on the user's device.",
                                            parameters: {
                                                type: Type.OBJECT,
                                                properties: { query: { type: Type.STRING, description: "File name or search term" } },
                                                required: ["query"]
                                            }
                                        },
                                        {
                                            name: "searchPhotos",
                                            description: "Search photos, gallery, or images on the device.",
                                            parameters: {
                                                type: Type.OBJECT,
                                                properties: { query: { type: Type.STRING, description: "Photo tag or date/location query" } },
                                                required: ["query"]
                                            }
                                        },
                                        {
                                            name: "searchGoogle",
                                            description: "Search Google for a query.",
                                            parameters: {
                                                type: Type.OBJECT,
                                                properties: { query: { type: Type.STRING } },
                                                required: ["query"]
                                            }
                                        },
                                        {
                                            name: "searchYouTube",
                                            description: "Search YouTube for a query.",
                                            parameters: {
                                                type: Type.OBJECT,
                                                properties: { query: { type: Type.STRING } },
                                                required: ["query"]
                                            }
                                        },
                                        {
                                            name: "callContact",
                                            description: "Query the contacts and trigger a phone call.",
                                            parameters: {
                                                type: Type.OBJECT,
                                                properties: { contactName: { type: Type.STRING } },
                                                required: ["contactName"]
                                            }
                                        },
                                        {
                                            name: "sendWhatsAppMessage",
                                            description: "Send a text message to a contact via WhatsApp.",
                                            parameters: {
                                                type: Type.OBJECT,
                                                properties: { contactName: { type: Type.STRING }, message: { type: Type.STRING } },
                                                required: ["contactName", "message"]
                                            }
                                        },
                                        {
                                            name: "sendGmail",
                                            description: "Open the email app to send an email.",
                                            parameters: {
                                                type: Type.OBJECT,
                                                properties: { recipientEmail: { type: Type.STRING }, subject: { type: Type.STRING }, body: { type: Type.STRING } },
                                                required: ["subject", "body"]
                                            }
                                        },
                                        {
                                            name: "searchInstalledApp",
                                            description: "Search for an installed app by its common name and return its package name.",
                                            parameters: {
                                                type: Type.OBJECT,
                                                properties: {
                                                    appName: { type: Type.STRING, description: "The name of the app to search for (e.g. YouTube, Instagram, Calculator)" }
                                                },
                                                required: ["appName"]
                                            }
                                        },
                                        {
                                            name: "openYouTube",
                                            description: "Open the YouTube app directly.",
                                            parameters: { type: Type.OBJECT, properties: {}, required: [] }
                                        },
                                        {
                                            name: "openInstagram",
                                            description: "Open the Instagram app directly.",
                                            parameters: { type: Type.OBJECT, properties: {}, required: [] }
                                        },
                                        {
                                            name: "openWhatsApp",
                                            description: "Open the WhatsApp app directly.",
                                            parameters: { type: Type.OBJECT, properties: {}, required: [] }
                                        },
                                        {
                                            name: "openChrome",
                                            description: "Open the Google Chrome browser directly.",
                                            parameters: { type: Type.OBJECT, properties: {}, required: [] }
                                        },
                                        {
                                            name: "openCamera",
                                            description: "Open the device Camera app directly.",
                                            parameters: { type: Type.OBJECT, properties: {}, required: [] }
                                        },
                                        {
                                            name: "searchAndCallContact",
                                            description: "Query the contacts and trigger a phone call.",
                                            parameters: {
                                                type: Type.OBJECT,
                                                properties: { contactName: { type: Type.STRING, description: "The name of the contact to call" } },
                                                required: ["contactName"]
                                            }
                                        }
                                    ]
                                }
                            ]
                        },
                        callbacks: {
                            onmessage: (serverMsg) => {
                                try {
                                    if (serverMsg.serverContent?.interrupted) {
                                        clientWs.send(JSON.stringify({ type: 'interrupted' }));
                                    }
                                    if (serverMsg.serverContent?.modelTurn) {
                                        const parts = serverMsg.serverContent.modelTurn.parts;
                                        parts.forEach(part => {
                                            if (part.inlineData && part.inlineData.data) {
                                                clientWs.send(JSON.stringify({ type: 'audio', data: part.inlineData.data }));
                                            }
                                            if (part.text) {
                                                clientWs.send(JSON.stringify({ type: 'text', data: part.text }));
                                            }
                                        });
                                    }
                                    if (serverMsg.serverContent?.turnComplete) {
                                        clientWs.send(JSON.stringify({ type: 'turnComplete' }));
                                    }
                                    if (serverMsg.toolCall) {
                                        const functionCalls = serverMsg.toolCall.functionCalls;
                                        if (functionCalls && functionCalls.length > 0) {
                                            const call = functionCalls[0];
                                            clientWs.send(JSON.stringify({
                                                type: 'toolCall',
                                                name: call.name,
                                                args: call.args
                                            }));
                                            
                                            // Send successful response immediately for simulated tools
                                            session.sendToolResponse({
                                                functionResponses: [
                                                    {
                                                        id: call.id,
                                                        name: call.name,
                                                        response: { result: "success" }
                                                    }
                                                ]
                                            });
                                        }
                                    }
                                } catch (err) {
                                    console.error("Error processing server message:", err);
                                }
                            },
                            onclose: () => {
                                clientWs.close();
                            }
                        }
                    });

                    clientWs.send(JSON.stringify({ type: "ready" }));

                } catch (error) {
                    console.error("Error connecting to Live API:", error);
                    clientWs.close();
                }
            } else if (msg.audio && session) {
                session.sendRealtimeInput({
                    audio: {
                        mimeType: "audio/pcm;rate=16000",
                        data: msg.audio
                    }
                });
            }
        } catch (err) {
            console.error("Error processing client message:", err);
        }
    });

    clientWs.on("close", () => {
        console.log("Client disconnected");
    });
});

// Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
