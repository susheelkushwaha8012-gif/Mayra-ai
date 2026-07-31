import fetch from 'node-fetch';
const apiKey = process.env.ELEVENLABS_API_KEY;
const voiceId = '21m00Tcm4TlvDq8ikWAM';
async function test() {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: "a" })
  });
  console.log(res.status, res.statusText);
  const text = await res.text();
  console.log(text);
}
test();
