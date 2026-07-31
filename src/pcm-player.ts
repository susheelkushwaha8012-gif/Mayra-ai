export class PCMPlayer {
  audioCtx: AudioContext;
  nextTime: number;
  sources: AudioBufferSourceNode[];

  constructor(sampleRate = 24000) {
    this.audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate });
    this.nextTime = 0;
    this.sources = [];
  }
  
  play(base64Data: string) {
    if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume();
    }
    // Decode base64 to binary string
    const binary = atob(base64Data);
    const len = binary.length;
    // Create Int16Array
    const buffer = new Int16Array(len / 2);
    for (let i = 0; i < len / 2; i++) {
       // Little endian
       const low = binary.charCodeAt(i * 2);
       const high = binary.charCodeAt(i * 2 + 1);
       buffer[i] = (high << 8) | low;
    }
    
    // Convert to Float32
    const float32 = new Float32Array(buffer.length);
    for (let i = 0; i < buffer.length; i++) {
       float32[i] = buffer[i] / 32768.0;
    }
    
    // Create AudioBuffer
    const audioBuffer = this.audioCtx.createBuffer(1, float32.length, this.audioCtx.sampleRate);
    audioBuffer.getChannelData(0).set(float32);
    
    // Play
    const source = this.audioCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.audioCtx.destination);
    
    if (this.nextTime < this.audioCtx.currentTime) {
      this.nextTime = this.audioCtx.currentTime + 0.05; // slight buffer
    }
    source.start(this.nextTime);
    this.nextTime += audioBuffer.duration;
    
    this.sources.push(source);
    
    source.onended = () => {
        this.sources = this.sources.filter(s => s !== source);
    };
  }
  
  stop() {
    this.sources.forEach(source => {
        try {
            source.stop();
        } catch(e) {
            // Ignore if already stopped
        }
    });
    this.sources = [];
    this.nextTime = 0;
  }
}
