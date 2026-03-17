import type { SessionResponse } from "./types";

export type TranscriptCallback = (text: string, isFinal: boolean) => void;

export class RealtimeTranscriber {
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private stream: MediaStream | null = null;
  private onTranscript: TranscriptCallback;

  constructor(onTranscript: TranscriptCallback) {
    this.onTranscript = onTranscript;
  }

  async start(): Promise<void> {
    // 1. Get ephemeral key from local server
    const res = await fetch("/session", { method: "POST" });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Session creation failed: ${text}`);
    }
    const session: SessionResponse = await res.json();
    const ephemeralKey = session.client_secret.value;

    // 2. Create RTCPeerConnection
    this.pc = new RTCPeerConnection();

    // 3. Get microphone audio
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.stream.getTracks().forEach((track) => {
      this.pc!.addTrack(track, this.stream!);
    });

    // Remote audio (muted - we only need transcription)
    const audioEl = document.createElement("audio");
    audioEl.autoplay = true;
    this.pc.ontrack = (e) => {
      audioEl.srcObject = e.streams[0];
      // Mute remote audio since we only want transcription
      audioEl.volume = 0;
    };

    // 4. Data channel for events
    this.dc = this.pc.createDataChannel("oai-events");
    this.dc.onopen = () => {
      // Update session to enable input audio transcription
      this.dc!.send(
        JSON.stringify({
          type: "session.update",
          session: {
            input_audio_transcription: {
              model: "gpt-4o-mini-transcribe",
            },
          },
        })
      );
    };

    this.dc.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        this.handleEvent(msg);
      } catch {
        // ignore parse errors
      }
    };

    // 5. Create offer and connect via OpenAI Realtime API
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);

    const sdpRes = await fetch(
      "https://api.openai.com/v1/realtime?model=gpt-4o-mini-realtime-preview",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ephemeralKey}`,
          "Content-Type": "application/sdp",
        },
        body: offer.sdp,
      }
    );

    if (!sdpRes.ok) {
      const text = await sdpRes.text();
      throw new Error(`SDP exchange failed: ${text}`);
    }

    const answerSdp = await sdpRes.text();
    await this.pc.setRemoteDescription({
      type: "answer",
      sdp: answerSdp,
    });
  }

  private handleEvent(msg: Record<string, unknown>): void {
    switch (msg.type) {
      case "conversation.item.input_audio_transcription.delta": {
        const delta = (msg as { delta?: string }).delta || "";
        if (delta) {
          this.onTranscript(delta, false);
        }
        break;
      }
      case "conversation.item.input_audio_transcription.completed": {
        const transcript = (msg as { transcript?: string }).transcript || "";
        if (transcript) {
          this.onTranscript(transcript, true);
        }
        break;
      }
      case "error": {
        console.error("Realtime API error:", msg);
        break;
      }
    }
  }

  stop(): void {
    if (this.dc) {
      this.dc.close();
      this.dc = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    if (this.pc) {
      this.pc.close();
      this.pc = null;
    }
  }
}
