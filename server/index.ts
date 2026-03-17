import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env") });
import express from "express";
import cors from "cors";
import OpenAI from "openai";

const app = express();
app.use(cors());
app.use(express.json());

let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!_openai) {
    _openai = new OpenAI();
  }
  return _openai;
}

// Ephemeral key 発行: OpenAI Realtime API の transcription session を作成
app.post("/session", async (_req, res) => {
  try {
    const response = await fetch(
      "https://api.openai.com/v1/realtime/sessions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o-mini-realtime-preview",
          modalities: ["text"],
          input_audio_transcription: {
            model: "gpt-4o-mini-transcribe",
          },
          turn_detection: {
            type: "server_vad",
            threshold: 0.5,
            prefix_padding_ms: 300,
            silence_duration_ms: 500,
          },
        }),
      }
    );

    if (!response.ok) {
      const text = await response.text();
      console.error("Session creation failed:", response.status, text);
      res.status(response.status).json({ error: text });
      return;
    }

    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error("Session error:", err);
    res.status(500).json({ error: String(err) });
  }
});

// 要約生成
app.post("/summarize", async (req, res) => {
  const { agendaText, transcriptText } = req.body;

  if (!transcriptText) {
    res.json({ summary: "" });
    return;
  }

  try {
    const completion = await getOpenAI().chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `あなたは会議の要約アシスタントです。
アジェンダと会議の文字起こしが与えられます。
各アジェンダ項目に関連する議論内容を箇条書きで抽出してください。
アジェンダ項目の文言はそのまま維持してください。
アジェンダに含まれない話題は「その他」にまとめてください。
該当する議論がない項目は points を空配列にしてください。`,
        },
        {
          role: "user",
          content: `【アジェンダ】\n${agendaText || "(なし)"}\n\n【文字起こし】\n${transcriptText}`,
        },
      ],
      max_tokens: 1024,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "agenda_summary",
          strict: true,
          schema: {
            type: "object",
            properties: {
              items: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    title: {
                      type: "string",
                      description: "アジェンダ項目名（原文そのまま）",
                    },
                    points: {
                      type: "array",
                      items: { type: "string" },
                      description: "その項目に関する議論ポイント",
                    },
                  },
                  required: ["title", "points"],
                  additionalProperties: false,
                },
              },
            },
            required: ["items"],
            additionalProperties: false,
          },
        },
      },
    });

    const raw = completion.choices[0]?.message?.content || "{}";
    console.log("Structured output:", raw);
    const parsed = JSON.parse(raw) as {
      items: { title: string; points: string[] }[];
    };

    // JSON → Markdown 変換
    const md = parsed.items
      .map((item) => {
        const lines = [`- ${item.title}`];
        for (const p of item.points) {
          lines.push(`  - ${p}`);
        }
        return lines.join("\n");
      })
      .join("\n");

    res.json({ summary: md });
  } catch (err) {
    console.error("Summarize error:", err);
    res.status(500).json({ error: String(err) });
  }
});

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
