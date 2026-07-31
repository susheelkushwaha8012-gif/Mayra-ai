import WebSocket from 'ws';
const wsUrl = `wss://api.elevenlabs.io/v1/text-to-speech/21m00Tcm4TlvDq8ikWAM/stream-input?model_id=eleven_turbo_v2_5&output_format=pcm_24000`;
const elevenLabsWs = new WebSocket(wsUrl, {
  headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY }
});
elevenLabsWs.on('open', () => {
  elevenLabsWs.send(JSON.stringify({ text: " ", voice_settings: { stability: 0.5, similarity_boost: 0.8 } }));
  elevenLabsWs.send(JSON.stringify({ text: "Hello", flush: true }));
  elevenLabsWs.send(JSON.stringify({ text: "" }));
});
elevenLabsWs.on('message', (msg) => {
  const data = JSON.parse(msg.toString());
  if (data.audio) {
    console.log("Audio", data.audio.length);
  } else {
    console.log("Msg", data);
  }
});
