'use client'

import { JSX, useEffect, useRef, useState } from "react";

const WS_URL = "wss://qa-knowlarity-service.exei.ai/socket";

type PlayAudioMessage = {
  type: "playAudio";
  data: {
    audioContent: string; // base64 PCM16
  };
};

type ServerMessage = PlayAudioMessage | Record<string, unknown>;

export default function home(): JSX.Element {
  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const logRef = useRef<HTMLPreElement | null>(null);

  const [connected, setConnected] = useState<boolean>(false);
  const [streaming, setStreaming] = useState<boolean>(false);

  const log = (msg: string): void => {
    if (!logRef.current) return;
    logRef.current.textContent += msg + "\n";
    logRef.current.scrollTop = logRef.current.scrollHeight;
  };

  const floatTo16BitPCM = (input: Float32Array): ArrayBuffer => {
    const buffer = new ArrayBuffer(input.length * 2);
    const view = new DataView(buffer);

    for (let i = 0; i < input.length; i++) {
      let s = Math.max(-1, Math.min(1, input[i]));
      view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }

    return buffer;
  };

  const connectWS = (): void => {
    const ws = new WebSocket(WS_URL);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    ws.onopen = (): void => {
      log("WS connected");

      const handshake = {
        ivr_data: JSON.stringify({
          clientId: "bbcf235b-f3c2-405f-aa57-2a4f9fed7bc6"
        }),
        callid: crypto.randomUUID(),
        virtual_number: "9999999999",
        customer_number: "8888888888",
        client_meta_id: "meta_001",
        event_timestamp: Date.now().toString()
      };

      ws.send(JSON.stringify(handshake));
      log("Handshake sent");
      setConnected(true);
    };

    ws.onclose = (): void => {
      log("WS closed");
      setConnected(false);
    };

    ws.onerror = (err: Event): void => {
      log("WS error");
      console.error(err);
    };

    ws.onmessage = (e: MessageEvent<string | ArrayBuffer>): void => {
      if (typeof e.data !== "string") return;

      try {
        const msg: ServerMessage = JSON.parse(e.data);

        if (
          (msg as PlayAudioMessage).type === "playAudio" &&
          (msg as PlayAudioMessage).data?.audioContent
        ) {
          playAudio((msg as PlayAudioMessage).data.audioContent);
        }

        log("Server msg: " + e.data);
      } catch {
        log("Server msg: " + e.data);
      }
    };
  };

  const playAudio = (base64PCM: string): void => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext({ sampleRate: 16000 });
    }

    const audioCtx = audioCtxRef.current;
    if (!audioCtx) return;

    const binary = atob(base64PCM);
    const pcm16 = new Int16Array(binary.length / 2);

    for (let i = 0; i < binary.length; i += 2) {
      pcm16[i / 2] =
        binary.charCodeAt(i) |
        (binary.charCodeAt(i + 1) << 8);
    }

    const float32 = new Float32Array(pcm16.length);
    for (let i = 0; i < pcm16.length; i++) {
      float32[i] = pcm16[i] / 32768;
    }

    const buffer = audioCtx.createBuffer(1, float32.length, audioCtx.sampleRate);
    buffer.getChannelData(0).set(float32);

    const source = audioCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(audioCtx.destination);
    source.start();
  };

  const startMic = async (): Promise<void> => {
    const audioCtx =
      audioCtxRef.current ?? new AudioContext({ sampleRate: 16000 });
    audioCtxRef.current = audioCtx;

    await audioCtx.resume();

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    micStreamRef.current = stream;

    const source = audioCtx.createMediaStreamSource(stream);
    const processor = audioCtx.createScriptProcessor(4096, 1, 1);

    source.connect(processor);
    processor.connect(audioCtx.destination);

    processor.onaudioprocess = (e: AudioProcessingEvent): void => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;

      const input = e.inputBuffer.getChannelData(0);
      ws.send(floatTo16BitPCM(input));
    };

    sourceRef.current = source;
    processorRef.current = processor;

    log("🎤 Mic streaming started");
    setStreaming(true);
  };

  const stopMic = (): void => {
    processorRef.current?.disconnect();
    sourceRef.current?.disconnect();
    micStreamRef.current?.getTracks().forEach(t => t.stop());

    audioCtxRef.current?.close();
    audioCtxRef.current = null;

    setStreaming(false);
    log("🛑 Mic streaming stopped");
  };

  useEffect(() => {
    return () => {
      wsRef.current?.close();
      stopMic();
    };
  }, []);

  return (
    <div style={{ background: "#0f172a", color: "#e5e7eb", padding: 20 }}>
      <h2>Fake Knowlarity WS Client</h2>

      <div className="mt-4">
        <button className="bg-white px-2 py-1 rounded text-black" onClick={connectWS} disabled={connected}>
        Connect
      </button>

      <button className="bg-white px-2 py-1 rounded text-black mx-3" onClick={startMic} disabled={!connected || streaming}>
        Start Audio
      </button>

      <button className="bg-white px-2 py-1 rounded text-black" onClick={stopMic} disabled={!streaming}>
        Stop Audio
      </button>
      </div>

      <pre
        ref={logRef}
        style={{
          background: "#30385eff",
          padding: 10,
          height: 900,
          overflow: "auto",
          borderRadius: 6,
          fontSize: 12,
          marginTop: 12
        }}
      />
    </div>
  );
}
