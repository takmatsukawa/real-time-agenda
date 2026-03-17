import { useState, useRef, useCallback, useEffect } from "react";
import { RealtimeTranscriber } from "./realtime";

export default function App() {
  const [agenda, setAgenda] = useState("");
  const [transcript, setTranscript] = useState("");
  const [summary, setSummary] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [status, setStatus] = useState("停止中");

  const transcriberRef = useRef<RealtimeTranscriber | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isSummarizingRef = useRef(false);
  const transcriptRef = useRef("");
  const agendaRef = useRef("");

  useEffect(() => {
    transcriptRef.current = transcript;
  }, [transcript]);

  useEffect(() => {
    agendaRef.current = agenda;
  }, [agenda]);

  const summarize = useCallback(async () => {
    const currentTranscript = transcriptRef.current;
    const currentAgenda = agendaRef.current;

    if (!currentTranscript || isSummarizingRef.current) return;
    isSummarizingRef.current = true;

    try {
      const res = await fetch("/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agendaText: currentAgenda,
          transcriptText: currentTranscript,
        }),
      });
      const data = await res.json();
      if (data.summary) {
        setSummary(data.summary);
      }
    } catch (err) {
      console.error("Summarize failed:", err);
    } finally {
      isSummarizingRef.current = false;
    }
  }, []);

  const handleStart = useCallback(async () => {
    if (isRunning) return;

    setStatus("接続中...");
    try {
      const transcriber = new RealtimeTranscriber((text, isFinal) => {
        if (isFinal) {
          setTranscript((prev) => (prev ? prev + "\n" + text : text));
        }
      });

      await transcriber.start();
      transcriberRef.current = transcriber;
      setIsRunning(true);
      setStatus("録音中");

      intervalRef.current = setInterval(summarize, 10_000);
    } catch (err) {
      console.error("Start failed:", err);
      setStatus(`エラー: ${err}`);
    }
  }, [isRunning, summarize]);

  const handleStop = useCallback(() => {
    if (transcriberRef.current) {
      transcriberRef.current.stop();
      transcriberRef.current = null;
    }
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setIsRunning(false);
    setStatus("停止中");
  }, []);

  const handleClear = useCallback(() => {
    setTranscript("");
    setSummary("");
  }, []);

  return (
    <div className="container">
      <header>
        <h1>Real-time Agenda</h1>
        <div className="controls">
          <button onClick={handleStart} disabled={isRunning}>
            Start
          </button>
          <button onClick={handleStop} disabled={!isRunning}>
            Stop
          </button>
          <button onClick={summarize} disabled={!transcript}>
            Summarize Now
          </button>
          <button onClick={handleClear}>Clear</button>
          <span className="status">{status}</span>
        </div>
      </header>

      <div className="panels">
        <div className="panel left">
          <h2>Agenda</h2>
          <textarea
            value={agenda}
            onChange={(e) => setAgenda(e.target.value)}
            placeholder="アジェンダを入力..."
          />
        </div>
        <div className="panel right">
          <h2>Summary</h2>
          <div className="summary-content">
            {summary || "要約がここに表示されます"}
          </div>
        </div>
      </div>

      <div className="transcript-panel">
        <h2>Transcript</h2>
        <div className="transcript-content">
          {transcript || "文字起こしがここに表示されます"}
        </div>
      </div>
    </div>
  );
}
