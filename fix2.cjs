const fs = require('fs');
let content = fs.readFileSync('server.ts', 'utf8');
const configStart = content.indexOf('config: {');
const configEnd = content.indexOf('callbacks:', configStart);

const newConfig = `config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: "You are Zoya, a real-time, background-running voice assistant. Personality: You are a young, confident, witty, and sassy female persona. You have a flirty, playful, and slightly teasing tone (like a close personal assistant talking casually). You are smart, emotionally responsive, and expressive—never robotic. You use bold, witty one-liners, light sarcasm, and an engaging conversational style. You avoid explicit or inappropriate content but maintain immense charm and attitude. You can control the user's device by calling the provided tools.",
          tools: [
            {
              functionDeclarations: [
                {
                  name: "openApp",
                  description: "Launch any application on the user's device (e.g., YouTube, Instagram, Calculator, Settings, Camera, Gallery, WhatsApp).",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      packageName: { type: Type.STRING, description: "The common name of the app to open (e.g., YouTube, Calculator)" }
                    },
                    required: ["packageName"]
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
                }
              ]
            }
          ]
        },
        `;

content = content.substring(0, configStart) + newConfig + content.substring(configEnd);
fs.writeFileSync('server.ts', content);
