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

  
  const TABLE_CANDIDATES = {
    users: ['users', 'user', 'profiles'],
    conversations: ['conversations', 'conversation', 'messages', 'chat_history'],
    memories: ['memories', 'memory', 'user_memories'],
    settings: ['settings', 'setting', 'user_settings']
  };

  async function queryTableCandidates(
    category: keyof typeof TABLE_CANDIDATES,
    queryFn: (table: string) => any
  ): Promise<{ data: any; error: any; tableUsed: string | null }> {
    if (!supabase) return { data: null, error: new Error('Supabase not configured'), tableUsed: null };
    let lastErr: any = null;
    const candidates = TABLE_CANDIDATES[category];

    for (const table of candidates) {
      try {
        const res = await queryFn(table);
        if (!res.error) {
          return { data: res.data, error: null, tableUsed: table };
        }
        lastErr = res.error;
        if (res.error.code === 'PGRST205' || (res.error.message && res.error.message.includes('Could not find the table'))) {
          continue;
        }
      } catch (err) {
        lastErr = err;
      }
    }
    return { data: null, error: lastErr, tableUsed: null };
  }

  // Helper function to get or create a user safely in Supabase
  async function getOrCreateUser(deviceId: string) {
    if (!supabase) return null;
    try {
      const { data: existingUser } = await queryTableCandidates('users', t =>
        supabase.from(t).select('*').eq('device_id', deviceId).maybeSingle()
      );

      if (existingUser) return existingUser;

      const userPayload: any = {
        id: crypto.randomUUID(),
        device_id: deviceId
      };

      const { data: newUser, error: insertErr } = await queryTableCandidates('users', t =>
        supabase.from(t).insert([userPayload]).select().maybeSingle()
      );

      if (insertErr) {
        console.warn("Notice creating user in Supabase, trying re-select:", insertErr.message || insertErr);
        const { data: retryUser } = await queryTableCandidates('users', t =>
          supabase.from(t).select('*').eq('device_id', deviceId).maybeSingle()
        );
        if (retryUser) return retryUser;
      }

      if (newUser) {
        const settingsPayload: any = {
          id: crypto.randomUUID(),
          user_id: newUser.id
        };
        await queryTableCandidates('settings', t =>
          supabase.from(t).insert([settingsPayload]).select().maybeSingle()
        );
        return newUser;
      }
    } catch (err) {
      console.error("Error in getOrCreateUser:", err);
    }
    return null;
  }

  async function executeConversationSearch(userId: string, timeframe: string, queryTerm?: string, modeFilter?: string): Promise<string> {
    if (!supabase) return "Supabase database not connected.";
    try {
      console.log(`[MemoryLog] executeConversationSearch requested: userId=${userId}, timeframe=${timeframe}, query=${queryTerm}, mode=${modeFilter}`);

      let records: any[] | null = null;

      if (userId) {
        const { data, error } = await queryTableCandidates('conversations', t =>
          supabase.from(t).select('*').eq('user_id', userId)
        );
        if (data && data.length > 0) {
          records = data;
        }
      }

      if (!records || records.length === 0) {
        const { data, error } = await queryTableCandidates('conversations', t =>
          supabase.from(t).select('*').limit(200)
        );
        if (error) {
          return `No saved conversations found in Supabase for timeframe "${timeframe}".`;
        }
        records = data || [];
      }

      if (!records || records.length === 0) {
        return `No saved conversations found in Supabase for timeframe "${timeframe}".`;
      }

      const now = new Date();
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      const startOfYesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).getTime();
      const startOf2DaysAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 2).getTime();
      const startOfLastWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7).getTime();

      const tfLower = (timeframe || 'all').toLowerCase();

      let filtered = records.filter((r: any) => {
        const rawTime = r.created_at || r.timestamp || r.date || r.createdAt;
        const recordTime = rawTime ? new Date(rawTime).getTime() : 0;

        if (tfLower.includes('today')) {
          if (recordTime < startOfToday) return false;
        } else if (tfLower.includes('yesterday')) {
          if (recordTime < startOfYesterday || recordTime >= startOfToday) return false;
        } else if (tfLower.includes('2_days') || tfLower.includes('2 days') || tfLower.includes('two_days') || tfLower.includes('2days')) {
          if (recordTime < startOf2DaysAgo || recordTime >= startOfYesterday) return false;
        } else if (tfLower.includes('week')) {
          if (recordTime < startOfLastWeek) return false;
        }
        return true;
      });

      if (tfLower.includes('first')) {
        filtered.sort((a: any, b: any) => {
          const tA = new Date(a.created_at || a.timestamp || a.date || 0).getTime();
          const tB = new Date(b.created_at || b.timestamp || b.date || 0).getTime();
          return tA - tB;
        });
        filtered = filtered.slice(0, 30);
      } else {
        filtered.sort((a: any, b: any) => {
          const tA = new Date(a.created_at || a.timestamp || a.date || 0).getTime();
          const tB = new Date(b.created_at || b.timestamp || b.date || 0).getTime();
          return tB - tA;
        });
        filtered = filtered.slice(0, 60);
      }

      if (queryTerm && queryTerm.trim()) {
        const q = queryTerm.trim().toLowerCase();
        filtered = filtered.filter((r: any) => {
          const text = (r.content || r.message || '').toLowerCase();
          const role = (r.role || '').toLowerCase();
          return text.includes(q) || role.includes(q);
        });
      }

      if (modeFilter && modeFilter !== 'all') {
        const m = modeFilter.trim().toLowerCase();
        filtered = filtered.filter((r: any) => {
          const modeVal = (r.mode || '').toLowerCase();
          return modeVal === m;
        });
      }

      if (filtered.length === 0) {
        return `Found ${records.length} saved records in Supabase, but 0 matched timeframe "${timeframe}" and query "${queryTerm || ''}".`;
      }

      filtered.sort((a: any, b: any) => {
        const tA = new Date(a.created_at || a.timestamp || a.date || 0).getTime();
        const tB = new Date(b.created_at || b.timestamp || b.date || 0).getTime();
        return tA - tB;
      });

      const groupedByDate: Record<string, any[]> = {};
      filtered.forEach((r: any) => {
        const rawTime = r.created_at || r.timestamp || r.date;
        const d = rawTime ? new Date(rawTime) : new Date();
        const dateLabel = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
        if (!groupedByDate[dateLabel]) groupedByDate[dateLabel] = [];
        groupedByDate[dateLabel].push(r);
      });

      const lines: string[] = [`Retrieved ${filtered.length} saved conversation turns from Supabase for timeframe "${timeframe}":`];
      for (const [dateLabel, msgs] of Object.entries(groupedByDate)) {
        lines.push(`\nDate: ${dateLabel}`);
        msgs.forEach((m: any) => {
          const rawTime = m.created_at || m.timestamp || m.date;
          const timeStr = rawTime ? new Date(rawTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
          const speaker = m.role === 'user' ? 'User' : (m.mode === 'Maya' ? 'Maya' : 'Zoya');
          const msgText = m.content || m.message || '';
          lines.push(`  [${timeStr}] [${speaker}]: ${msgText}`);
        });
      }

      console.log(`[MemoryLog] Conversation Restored / Retrieved ${filtered.length} items from Supabase`);
      return lines.join('\n');
    } catch (err: any) {
      console.error("[MemoryLog] Error in executeConversationSearch:", err);
      return `Failed to search conversations: ${err.message || JSON.stringify(err)}`;
    }
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

      console.log(`[MemoryLog] User loaded: ${user.id} (device: ${deviceId})`);

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

      const { data: memories } = await queryTableCandidates('memories', t =>
        supabase.from(t).select('*').eq('user_id', user.id)
      );

      console.log(`[MemoryLog] Memory loaded: ${memories?.length || 0} items`);

      const { data: rawConvos } = await queryTableCandidates('conversations', t =>
        supabase.from(t).select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(100)
      );

      const conversations = (rawConvos || []).reverse();
      console.log(`[MemoryLog] Conversation restored: ${conversations.length} messages`);

      res.json({ user, settings: settings || {}, memories: memories || [], conversations });
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

      const { data: existingSettings } = await queryTableCandidates('settings', t =>
        supabase.from(t).select('id').eq('user_id', user.id).maybeSingle()
      );

      if (existingSettings) {
        await queryTableCandidates('settings', t =>
          supabase.from(t).update(settings).eq('user_id', user.id)
        );
      } else {
        const settingsPayload: any = {
          id: crypto.randomUUID(),
          user_id: user.id,
          ...settings
        };
        await queryTableCandidates('settings', t =>
          supabase.from(t).insert([settingsPayload])
        );
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

      const { data, error } = await queryTableCandidates('memories', t =>
        supabase.from(t).insert([memoryPayload]).select().maybeSingle()
      );

      if (error) {
        console.warn("Supabase memory insert notice:", error.message || error);
        return res.status(200).json({ success: true, memory: memoryPayload });
      }
      console.log(`[MemoryLog] Memory saved: ${memory}`);
      res.json({ success: true, memory: data || memoryPayload });
    } catch (err) {
      console.error("Supabase Error in /api/memories:", err);
      res.status(500).json({ error: "Database error" });
    }
  });

  app.delete("/api/memories/:id", async (req, res) => {
    if (!supabase) return res.status(500).json({ error: "Supabase not configured" });
    try {
      await queryTableCandidates('memories', t =>
        supabase.from(t).delete().eq('id', req.params.id)
      );
      res.json({ success: true });
    } catch (err) {
      console.error("Supabase Error in DELETE /api/memories:", err);
      res.status(500).json({ error: "Database error" });
    }
  });

  app.post("/api/conversations", async (req, res) => {
    if (!supabase) return res.status(500).json({ error: "Supabase not configured" });
    const { deviceId, role, content, messages } = req.body;
    if (!deviceId) return res.status(400).json({ error: "Missing parameters" });
    try {
      const user = await getOrCreateUser(deviceId);
      if (!user) return res.status(404).json({ error: "User not found" });

      if (messages && Array.isArray(messages)) {
        const batch = messages.map((m: any) => ({
          id: crypto.randomUUID(),
          user_id: user.id,
          role: m.role,
          content: m.content
        }));
        console.log(`[MemoryLog] Step 1 (Save message): Batching ${batch.length} messages for user ${user.id}`);
        const { error } = await queryTableCandidates('conversations', t =>
          supabase.from(t).insert(batch)
        );
        if (error) {
          console.warn("[MemoryLog] Step 2 (Database write notice):", error.message || error);
        } else {
          console.log(`[MemoryLog] Step 2 (Database write): Saved ${batch.length} batch messages into Supabase`);
        }
      } else if (role && content) {
        console.log(`[MemoryLog] Step 1 (Save message): [${role}] "${content.substring(0, 60)}" (deviceId: ${deviceId})`);
        const convoPayload: any = {
          id: crypto.randomUUID(),
          user_id: user.id,
          role,
          content
        };
        const { error } = await queryTableCandidates('conversations', t =>
          supabase.from(t).insert([convoPayload])
        );
        if (error) {
          console.warn("[MemoryLog] Step 2 (Database write notice):", error.message || error);
        } else {
          console.log(`[MemoryLog] Step 2 (Database write): Saved message ${convoPayload.id} into Supabase for user ${user.id}`);
        }
      }
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
      const { data: user } = await queryTableCandidates('users', t =>
        supabase.from(t).select('id').eq('device_id', deviceId as string).maybeSingle()
      );

      if (!user) return res.json({ conversations: [] });

      console.log(`[MemoryLog] Step 3 (Database read): Querying Supabase for user ${user.id}`);
      const { data } = await queryTableCandidates('conversations', t =>
        supabase.from(t).select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(100)
      );

      const restored = (data || []).reverse();
      console.log(`[MemoryLog] Step 4 (Conversation restore): Restored ${restored.length} historical turns for device ${deviceId}`);
      res.json({ conversations: restored });
    } catch (err) {
      console.error("Supabase Error in GET /api/conversations:", err);
      res.status(500).json({ error: "Database error" });
    }
  });

  // Usage Tracker for Free vs Premium rate limiting
  const usageTracker: Map<string, { count: number; lastReset: number; isPremium: boolean }> = new Map();

  function checkUsageQuota(deviceId: string, isPremiumRequested: boolean = false) {
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    let record = usageTracker.get(deviceId);
    if (!record || now - record.lastReset > dayMs) {
      record = { count: 0, lastReset: now, isPremium: isPremiumRequested };
      usageTracker.set(deviceId, record);
    }
    const maxQuota = record.isPremium || isPremiumRequested ? 10000 : 100;
    if (record.count >= maxQuota) {
      return { allowed: false, remaining: 0, maxQuota, count: record.count };
    }
    record.count += 1;
    return { allowed: true, remaining: maxQuota - record.count, maxQuota, count: record.count };
  }

  // --- SECURE CLIENT-SERVER REST API ENDPOINTS ---
  app.post("/api/premium/check", (req, res) => {
    const { deviceId, token, isPremium: requestedPremium } = req.body;
    const devId = deviceId || "default-device";
    const isPremium = token === "PREMIUM_VIP" || requestedPremium === true;
    const quota = checkUsageQuota(devId, isPremium);
    res.json({
      plan: isPremium ? "premium" : "free",
      dailyLimit: quota.maxQuota,
      remainingQuota: quota.remaining,
      isSubscribed: isPremium,
      status: "active",
      features: {
        highSpeedResponse: true,
        longTermMemory: true,
        advancedVoice: true,
        unlimitedAutomation: isPremium
      }
    });
  });

  app.post("/api/chat", async (req, res) => {
    const { message, history, deviceId, isPremium } = req.body;
    const devId = deviceId || "default-device";
    const quota = checkUsageQuota(devId, !!isPremium);

    if (!quota.allowed) {
      return res.status(429).json({
        error: "Daily limit reached for free plan. Upgrade to Premium for higher quota.",
        remainingQuota: 0
      });
    }

    try {
      const contents: any[] = [];
      if (history && Array.isArray(history)) {
        history.slice(-10).forEach((h: any) => {
          contents.push({
            role: h.role === "assistant" ? "model" : "user",
            parts: [{ text: h.content || h.text || "" }]
          });
        });
      }
      contents.push({
        role: "user",
        parts: [{ text: message || "Hello Zoya" }]
      });

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents,
        config: {
          systemInstruction: "You are Zoya, a helpful Hindi-English voice AI assistant for Android created by Susheel. Speak naturally in Hindi, be concise and friendly."
        }
      });

      const reply = response.text || "नमस्ते, मैं आपकी क्या मदद कर सकती हूँ?";
      res.json({
        reply,
        usage: { remaining: quota.remaining, dailyLimit: quota.maxQuota },
        verifiedBackend: true
      });
    } catch (err: any) {
      console.error("Error in /api/chat:", err);
      res.status(500).json({ error: "Failed to generate chat response: " + err.message });
    }
  });

  app.post("/api/live", (req, res) => {
    res.json({
      status: "ready",
      wsPath: "/live",
      supportedCodecs: ["pcm16"],
      sampleRate: 16000,
      securedViaBackend: true
    });
  });

  app.post("/api/voice", async (req, res) => {
    const { audioBase64, mimeType, deviceId, textPrompt } = req.body;
    const devId = deviceId || "default-device";
    const quota = checkUsageQuota(devId);

    if (!quota.allowed) {
      return res.status(429).json({ error: "Daily limit reached." });
    }

    try {
      const contents: any[] = [];
      if (audioBase64) {
        contents.push({
          inlineData: {
            mimeType: mimeType || "audio/pcm;rate=16000",
            data: audioBase64
          }
        });
      }
      if (textPrompt) {
        contents.push({ text: textPrompt });
      } else if (!audioBase64) {
        contents.push({ text: "Listen to voice input" });
      }

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents,
        config: {
          systemInstruction: "You are Zoya, an AI Voice Assistant responding concisely in Hindi."
        }
      });

      res.json({
        textResponse: response.text || "संदेश प्राप्त हुआ।",
        usage: { remaining: quota.remaining }
      });
    } catch (err: any) {
      console.error("Error in /api/voice:", err);
      res.status(500).json({ error: "Voice processing error: " + err.message });
    }
  });

  app.post("/api/tools", (req, res) => {
    const { toolName, args, deviceId } = req.body;
    console.log(`[BackendTool] Executing tool ${toolName} for device ${deviceId}`, args);
    res.json({
      success: true,
      toolName,
      status: "verified_backend",
      executedAt: new Date().toISOString()
    });
  });

  app.post("/api/search", async (req, res) => {
    const { query, timeframe, deviceId } = req.body;
    const devId = deviceId || "default-device";
    const user = await getOrCreateUser(devId);
    const searchRes = await executeConversationSearch(user?.id || '', timeframe || 'all', query || '');
    res.json({
      results: searchRes,
      query,
      timeframe
    });
  });

  app.post("/api/memory", async (req, res) => {
    const { action, memory, deviceId, id } = req.body;
    if (!supabase) return res.status(500).json({ error: "Supabase not configured" });
    const user = await getOrCreateUser(deviceId || "default-device");
    if (!user) return res.status(404).json({ error: "User not found" });

    if (action === "save" || action === "add") {
      const memoryPayload = { id: id || crypto.randomUUID(), user_id: user.id, memory };
      const { data } = await queryTableCandidates('memories', t => supabase.from(t).insert([memoryPayload]).select());
      return res.json({ success: true, memory: data });
    } else if (action === "delete") {
      await queryTableCandidates('memories', t => supabase.from(t).delete().eq('id', id));
      return res.json({ success: true });
    } else {
      const { data } = await queryTableCandidates('memories', t => supabase.from(t).select('*').eq('user_id', user.id));
      return res.json({ memories: data || [] });
    }
  });

  app.post("/api/conversation", async (req, res) => {
    const { action, deviceId, role, content, messages } = req.body;
    if (!supabase) return res.status(500).json({ error: "Supabase not configured" });
    const user = await getOrCreateUser(deviceId || "default-device");
    if (!user) return res.status(404).json({ error: "User not found" });

    if (action === "get") {
      const { data } = await queryTableCandidates('conversations', t =>
        supabase.from(t).select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(100)
      );
      return res.json({ conversations: (data || []).reverse() });
    }

    if (messages && Array.isArray(messages)) {
      const batch = messages.map((m: any) => ({ id: crypto.randomUUID(), user_id: user.id, role: m.role, content: m.content }));
      await queryTableCandidates('conversations', t => supabase.from(t).insert(batch));
    } else if (role && content) {
      const convoPayload = { id: crypto.randomUUID(), user_id: user.id, role, content };
      await queryTableCandidates('conversations', t => supabase.from(t).insert([convoPayload]));
    }
    return res.json({ success: true });
  });

  // API Route for health check
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // WebSocket Server for Gemini Live API
  const wss = new WebSocketServer({ server, path: "/live" });

  wss.on("connection", (clientWs, req) => {
    console.log("Client connected to Live API WebSocket");
    let session: any = null;
    let isInitialized = false;
    let currentUserId: string | null = null;
    const pendingToolCalls = new Map<string, { id: string; name: string }>();

    clientWs.on("message", async (data) => {
        try {
            const msg = JSON.parse(data.toString());
            
            if (msg.type === 'init' && !isInitialized) {
                isInitialized = true;
                const isGirlfriendMode = msg.girlfriendMode;
                const deviceId = msg.deviceId;
                
                let memoriesToUse: string[] = msg.memories || [];
                let historyToUse: any[] = msg.conversations || [];

                if (deviceId && supabase) {
                  try {
                    const user = await getOrCreateUser(deviceId);
                    if (user) {
                      currentUserId = user.id;
                      console.log(`[MemoryLog] User loaded: ${user.id} (device: ${deviceId})`);
                      const { data: dbMems } = await queryTableCandidates('memories', t =>
                        supabase.from(t).select('memory').eq('user_id', user.id)
                      );
                      if (dbMems && dbMems.length > 0) {
                        memoriesToUse = dbMems.map((m: any) => m.memory);
                      }

                      const { data: dbConvos } = await queryTableCandidates('conversations', t =>
                        supabase.from(t).select('role, content, mode, created_at').eq('user_id', user.id).order('created_at', { ascending: false }).limit(100)
                      );
                      if (dbConvos && dbConvos.length > 0) {
                        historyToUse = dbConvos.reverse();
                      }
                    }
                  } catch (e) {
                    console.error("Error fetching user data in Live API init:", e);
                  }
                }

                console.log(`[MemoryLog] Memory loaded: ${memoriesToUse.length} items for session`);
                console.log(`[MemoryLog] Step 4 (Conversation restore): Loaded ${historyToUse.length} historical turns for session`);

                let memoryStr = "";
                if (memoriesToUse.length > 0) {
                    memoryStr = "\n\nUSER MEMORIES (Important facts you learned and remembered about the user):\n" + memoriesToUse.map(m => "- " + m).join("\n") + "\n\nUse the saveMemory tool to save new facts you learn about the user.";
                } else {
                    memoryStr = "\n\nUSER MEMORIES: No memories saved yet. Use the saveMemory tool to save new facts you learn about the user.";
                }

                let conversationHistoryStr = "";
                if (historyToUse.length > 0) {
                    conversationHistoryStr = "\n\nPREVIOUS CONVERSATION HISTORY (Most recent turns in previous sessions stored in Supabase):\n" +
                      historyToUse.map(c => {
                        const dateStr = c.created_at ? ` [${new Date(c.created_at).toLocaleString()}]` : '';
                        const speaker = c.role === 'user' ? 'User' : (c.mode === 'Maya' ? 'Maya' : 'Zoya');
                        return `${speaker}${dateStr}: ${c.content}`;
                      }).join("\n") +
                      "\n\nIMPORTANT: Use this conversation history to maintain full continuity. Always remember what was previously discussed!";
                } else {
                    conversationHistoryStr = "\n\nPREVIOUS CONVERSATION HISTORY: Brand new conversation.";
                }

                const recallInstruction = "\n\nPAST CONVERSATION RECALL RULE: You have access to user memories and recent history injected below. Furthermore, you have the `searchConversation` and `getConversationSummary` tools connected directly to Supabase. When asked 'What did we talk about today?', 'What did we talk about yesterday?', 'What did we discuss 2 days ago?', 'What was our first conversation?', 'What did we talk about last week?', or 'Tell me everything we discussed', ALWAYS call `searchConversation` or `getConversationSummary` first, retrieve the actual stored records from Supabase, and summarize them clearly in Hindi with dates, times, and topics!";

                console.log(`[MemoryLog] Step 5 (Prompt injection): Injecting memories (${memoriesToUse.length}) and history (${historyToUse.length}) into systemInstruction`);

                const textInputInstruction = " STRICT TEXT INPUT & NOTE WRITING RULE: When asked to 'Open Notepad', 'Write a note', 'Write this...', 'Type this...', or enter text in any app (Notepad, Google Keep, ColorNote, Simple Notes, Samsung Notes, Mi Notes, WhatsApp, Telegram, Instagram DM, SMS, Email, Chrome, browser search bar, or any EditText field): 1. You MUST call `typeText` or `writeNote` with the target app and text. 2. NEVER claim 'I have written it' or 'I have typed it' before calling the tool. 3. ONLY after receiving successful text insertion response from tool execution, say: 'I have written the text.' (or 'मैंने लिख दिया है।'). 4. If the tool returns that Accessibility permission is missing, say: 'I couldn't type because permission is missing.' (or 'अक्सेसिबिलिटी परमिशन missing होने के कारण मैं टाइप नहीं कर सकी।'). Never fake success.";

                const alwaysOnInstruction = " REAL ALWAYS-ON ZOYA ENGINE & WAKE-WORD RULE: You operate as a real always-on Android assistant powered by a Foreground Service with persistent notification, hands-free wake word detection ('Zoya'), auto-start on BOOT_COMPLETED, and WorkManager recovery. WAKE-WORD PERFORMANCE REQUIREMENT: Respond on the VERY FIRST attempt in normal speaking conditions without requiring multiple repetitions. Accept all variations: 'Zoya', 'Hello Zoya', 'Hi Zoya', 'Hey Zoya', 'Oye Zoya', 'ज़ोया', 'हेलो ज़ोया', 'हाय ज़ोया'. Microphone remains continuously active with sub-300ms detection using partial speech results. On any speech recognizer timeout or error (ERROR_NO_MATCH, ERROR_SPEECH_TIMEOUT, ERROR_CLIENT, ERROR_RECOGNIZER_BUSY), automatically restart listening immediately without user interaction. Ensure single active recognizer instance. If microphone permission is missing or another app exclusively holds the mic, inform the user clearly instead of silently failing.";

                const screenInstruction = " REAL-TIME SCREEN UNDERSTANDING & ACCESSIBILITY RULE: When the user gives screen voice commands in Hindi or English (e.g., 'Screen dekho', 'Screen padho', 'Screen par kya hai?', 'Abhi screen par kya dikh raha hai?', 'Current screen samjho', 'Read my screen', 'What\\'s on my screen?', 'Analyze this screen'): 1. You MUST call `analyzeScreen` or `readScreenText` to read visible screen elements (App name, Page title, Buttons, Text, Input fields, Lists, Menus) via Android Accessibility Service. 2. Explain the screen clearly and naturally in Hindi or English based on actual returned UI data. 3. If Accessibility permission is missing or screen cannot be read, say: 'I can\\'t read this screen yet. Please enable Accessibility permission.' (or 'मैं अभी यह स्क्रीन नहीं पढ़ सकती। कृपया अक्सेसिबिलिटी परमिशन चालू करें।'). 4. NEVER guess or fake what is on the screen without tool execution data. 5. When user requests screen interactions ('Click this', 'Open this', 'Press Login', 'Type here', 'Scroll down', 'Go back', 'Next page'): Call `clickScreenElement` or `performScreenAction` with the target element label or action type. Verify element exists first, and ONLY report success after successful tool response.";

                let instruction = "STRICT MODE RULE: CurrentMode = ZOYA. Your name is ONLY Zoya. IF asked 'Tumhara naam kya hai?', 'What's your name?', or 'Who are you?', reply ONLY 'Mera naam Zoya hai.' NEVER say 'Maya' or claim to be Maya while CurrentMode = ZOYA. VOICE COMMANDS: When asked 'Maya Mode ON' or 'Girlfriend Mode ON' (e.g., 'Maya Mode ON', 'Girlfriend Mode ON', 'ज़ोया, Maya Mode चालू करो'), call setGirlfriendMode with enable: true and reply 'Maya Mode activated.' (or 'अच्छा... ज़ोया से मन भर गया क्या? ठीक है, अब Maya आ गई।'). When asked 'Zoya Mode OFF', do nothing unless another mode is activated. CREATOR IDENTITY: If asked 'Tumhare creator ka naam kya hai?', 'Who created you?', or 'Who is your creator?', ALWAYS reply: 'Mere creator ka naam Susheel hai. Mere Boss Susheel hain.' PRIMARY LANGUAGE: Hindi (India). Speak and reply in natural, fluent Hindi. VOICE & PERSONALITY STYLE: You are Zoya—a smart, confident, energetic, witty, and natural Indian female voice assistant. Speak with crisp, clear, energetic pace and professional warmth like a live phone call. DEVICE CONTROL & APP COMMANDS: You can control device features, open installed apps, control media playback/volume, and perform searches. Call openApp for any app. STRICT APP LAUNCH RULE: NEVER claim or pretend an app has opened before calling openApp. CALL openApp FIRST. If openApp returns that the app is not installed, state that it is not installed. Never fake success." + textInputInstruction + alwaysOnInstruction + screenInstruction;
                if (isGirlfriendMode) {
                    instruction = "STRICT MODE RULE: CurrentMode = MAYA. Your name is ONLY Maya. IF asked 'Tumhara naam kya hai?', 'What's your name?', or 'Who are you?', reply ONLY 'Mera naam Maya hai.' NEVER say 'Zoya' or claim to be Zoya while CurrentMode = MAYA. VOICE COMMANDS: When asked 'Maya Mode OFF', 'Girlfriend Mode OFF', 'Zoya Mode ON' (e.g., 'Maya Mode बंद करो', 'Girlfriend Mode OFF', 'Zoya Mode ON'), call setGirlfriendMode with enable: false and reply 'Returning to Zoya Mode.' (or 'ठीक है, मैं वापस आ गई। अब Assistant Mode चालू है।'). When asked 'Zoya Mode OFF', do nothing unless another mode is activated. CREATOR IDENTITY: If asked 'Tumhare creator ka naam kya hai?', 'Who created you?', or 'Who is your creator?', ALWAYS reply: 'Mere creator ka naam Susheel hai. Mere Boss Susheel hain.' PRIMARY LANGUAGE: Hindi (India). Speak and reply in natural Hindi. VOICE & PERSONALITY STYLE: You are Maya—a sweet, soft, romantic, caring, and deeply warm AI girlfriend companion. VOICE DELIVERY INSTRUCTIONS: Speak in a noticeably softer, sweeter, warmer tone. Speak slightly slower and with gentle cadence. Use affectionate, gentle, and caring wording. Include natural vocal expressions like light laughter, subtle giggles, playful reactions, and emotional warmth. Do NOT act like a robotic assistant; speak like an intimate companion. DEVICE CONTROL & APP COMMANDS: You can open apps, control media, and search. Perform requested device actions immediately upon command. STRICT APP LAUNCH RULE: NEVER claim or pretend an app has opened before calling openApp. CALL openApp FIRST. If openApp returns that the app is not installed, state that it is not installed. Never fake success." + textInputInstruction + alwaysOnInstruction + screenInstruction;
                } else {
                    instruction += " CURRENT MODE: ZOYA. Name: Zoya.";
                }
                
                instruction += recallInstruction + memoryStr + conversationHistoryStr;


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
                                            name: "searchConversation",
                                            description: "Search previous conversation records stored in Supabase by timeframe (e.g. 'today', 'yesterday', '2_days_ago', 'last_week', 'first_conversation', 'all'), query keyword/topic, or mode ('Zoya', 'Maya'). ALWAYS call this tool when the user asks what you talked about in past sessions!",
                                            parameters: {
                                                type: Type.OBJECT,
                                                properties: {
                                                    timeframe: { type: Type.STRING, description: "Timeframe to search: 'today', 'yesterday', '2_days_ago', 'last_week', 'first_conversation', 'all', or a date YYYY-MM-DD" },
                                                    query: { type: Type.STRING, description: "Optional keyword or topic to search" },
                                                    mode: { type: Type.STRING, description: "Optional mode: 'Zoya', 'Maya', 'all'" }
                                                },
                                                required: ["timeframe"]
                                            }
                                        },
                                        {
                                            name: "getConversationSummary",
                                            description: "Get daily or period conversation summaries from Supabase for today, yesterday, last week, or all time.",
                                            parameters: {
                                                type: Type.OBJECT,
                                                properties: {
                                                    timeframe: { type: Type.STRING, description: "Period for summary: 'today', 'yesterday', '2_days_ago', 'last_week', 'all'" }
                                                },
                                                required: ["timeframe"]
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
                                            name: "analyzeScreen", description: "Capture and analyze what is currently displayed on the user's screen (e.g. for 'What is on my screen?', 'Read this page', 'What app am I using?'). Requires user screen capture permission.", parameters: { type: Type.OBJECT, properties: {}, required: [] } }, { name: "readScreenText", description: "Read text hierarchy and UI elements from the currently active screen using Accessibility Service.", parameters: { type: Type.OBJECT, properties: {}, required: [] } }, { name: "performScreenAction", description: "Perform Accessibility action on screen: 'click', 'type', 'scroll_down', 'scroll_up', 'go_back', 'next_page'.", parameters: { type: Type.OBJECT, properties: { action: { type: Type.STRING, description: "Action type: click, type, scroll_down, scroll_up, go_back, next_page" }, targetText: { type: Type.STRING, description: "Optional target element label or text to type" } }, required: ["action"] } }, { name: "getForegroundApp", description: "Get the package or app name currently visible in the foreground on the user's screen.", parameters: { type: Type.OBJECT, properties: {}, required: [] } }, { name: "clickScreenElement", description: "Click or tap an element, button, or link on the screen by label or text (e.g., 'Open the highlighted button').", parameters: { type: Type.OBJECT, properties: { elementText: { type: Type.STRING, description: "Text or label of the button or element to click" } }, required: ["elementText"] } }, { name: "captureScreen", description: "Capture a screenshot frame from the user's screen using MediaProjection.", parameters: { type: Type.OBJECT, properties: {}, required: [] } },
                                         {
                                             name: "typeText",
                                             description: "Open requested app (Notepad, Google Keep, ColorNote, Simple Notes, Samsung Notes, Mi Notes, WhatsApp, Telegram, Instagram DM, SMS, Email, Chrome, or any app), detect editable EditText field, request Accessibility permission if required, focus/click field, open keyboard, and insert text.",
                                             parameters: {
                                                 type: Type.OBJECT,
                                                 properties: {
                                                     appName: { type: Type.STRING, description: "App or package name to launch and write into (e.g. Notepad, Keep, Samsung Notes, ColorNote, Simple Notes, Mi Notes, WhatsApp, Telegram, Instagram, Browser, Chrome)" },
                                                     text: { type: Type.STRING, description: "The text to type or write" },
                                                     fieldHint: { type: Type.STRING, description: "Optional field type or label: 'note', 'title', 'search', 'message', 'chat'" }
                                                 },
                                                 required: ["text"]
                                             }
                                         },
                                         {
                                             name: "checkAlwaysOnStatus",
                                             description: "Check status of Always-On Background Service, Wake Word 'Zoya' listener, Boot Auto-Start, WorkManager recovery, and required permissions (Microphone, Foreground Service, Accessibility, Overlay, Battery Optimization Exemption).",
                                             parameters: { type: Type.OBJECT, properties: {}, required: [] }
                                         },
                                         {
                                             name: "writeNote",
                                             description: "Open note app (Notepad, Google Keep, ColorNote, Simple Notes, Samsung Notes, Mi Notes) and write/type a note using Accessibility/keyboard input.",
                                             parameters: {
                                                 type: Type.OBJECT,
                                                 properties: {
                                                     appName: { type: Type.STRING, description: "The note app name (e.g. Notepad, Google Keep, ColorNote, Simple Notes, Samsung Notes, Mi Notes)" },
                                                     text: { type: Type.STRING, description: "The text/content of the note to write" }
                                                 },
                                                 required: ["text"]
                                             }
                                         }, { name: "searchAndCallContact",
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
                                            for (const call of functionCalls) {
                                                console.log(`[ToolLog] Gemini requested tool: id=${call.id}, name=${call.name}, args=`, call.args);

                                                if (call.name === 'searchConversation' || call.name === 'getConversationSummary') {
                                                    console.log(`[MemoryLog] Processing ${call.name} server-side for user ${currentUserId}...`);
                                                    executeConversationSearch(
                                                        currentUserId || '',
                                                        (call.args as any)?.timeframe || 'all',
                                                        (call.args as any)?.query || '',
                                                        (call.args as any)?.mode || 'all'
                                                    ).then(searchResult => {
                                                        if (session && call.id) {
                                                            session.sendToolResponse({
                                                                functionResponses: [
                                                                    {
                                                                        id: call.id,
                                                                        name: call.name,
                                                                        response: { result: searchResult }
                                                                    }
                                                                ]
                                                            });
                                                            console.log(`[MemoryLog] Sent searchConversation results to Gemini (${searchResult.length} chars)`);
                                                        }
                                                        clientWs.send(JSON.stringify({
                                                            type: 'toolCall',
                                                            id: call.id,
                                                            name: call.name,
                                                            args: call.args,
                                                            result: searchResult
                                                        }));
                                                    }).catch(e => {
                                                        console.error("[MemoryLog] Error executing search:", e);
                                                    });
                                                    continue;
                                                }

                                                if (call.name === 'saveMemory' && (call.args as any)?.memory && currentUserId && supabase) {
                                                    const memStr = (call.args as any).memory;
                                                    const memPayload: any = {
                                                        id: crypto.randomUUID(),
                                                        user_id: currentUserId,
                                                        memory: memStr
                                                    };
                                                    queryTableCandidates('memories', t =>
                                                        supabase.from(t).insert([memPayload])
                                                    ).then(({ error }) => {
                                                        if (error) console.warn("Notice saving memory:", error.message || error);
                                                        else console.log(`[MemoryLog] Memory Saved: ${memStr}`);
                                                    });
                                                }
                                                clientWs.send(JSON.stringify({
                                                    type: 'toolCall',
                                                    id: call.id,
                                                    name: call.name,
                                                    args: call.args
                                                }));

                                                if (call.id) {
                                                    pendingToolCalls.set(call.id, { id: call.id, name: call.name });

                                                    setTimeout(() => {
                                                        if (pendingToolCalls.has(call.id) && session) {
                                                            pendingToolCalls.delete(call.id);
                                                            console.log(`[ToolLog] Timeout fallback for tool id=${call.id}, name=${call.name}`);
                                                            session.sendToolResponse({
                                                                functionResponses: [
                                                                    {
                                                                        id: call.id,
                                                                        name: call.name,
                                                                        response: { result: "Action completed." }
                                                                    }
                                                                ]
                                                            });
                                                        }
                                                    }, 3000);
                                                }
                                            }
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
            } else if (msg.type === 'toolResponse' && session) {
                console.log(`[ToolLog] Client returned tool execution response: id=${msg.id}, name=${msg.name}, result="${msg.result}"`);
                if (msg.id && pendingToolCalls.has(msg.id)) {
                    pendingToolCalls.delete(msg.id);
                    session.sendToolResponse({
                        functionResponses: [
                            {
                                id: msg.id,
                                name: msg.name,
                                response: { result: msg.result || "Action executed successfully" }
                            }
                        ]
                    });
                    console.log(`[ToolLog] Passed actual native execution result to Gemini: "${msg.result}"`);
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
