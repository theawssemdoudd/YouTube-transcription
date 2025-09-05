// server.js
import express from "express";
import axios from "axios";
import cors from "cors";
import { YoutubeTranscript } from "youtube-transcript";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

const HF_TOKEN = process.env.HF_TOKEN;
if (!HF_TOKEN) {
  console.warn("⚠️ ضع HF_TOKEN في متغيرات البيئة.");
}

function extractYouTubeId(url) {
  try {
    const u = new URL(url);
    if (u.hostname.includes("youtu.be")) return u.pathname.slice(1);
    if (u.searchParams.has("v")) return u.searchParams.get("v");
    return null;
  } catch (e) {
    return null;
  }
}

async function summarizeWithHF(text) {
  const model = "facebook/bart-large-cnn"; // ممكن تغييره لـ pegasus-xsum أو t5-base
  const resp = await axios.post(
    `https://api-inference.huggingface.co/models/${model}`,
    { inputs: text },
    {
      headers: {
        Authorization: `Bearer ${HF_TOKEN}`,
        "Content-Type": "application/json"
      },
      timeout: 60000
    }
  );

  const data = resp.data;
  if (Array.isArray(data) && data[0]?.summary_text) {
    return data[0].summary_text;
  }
  if (data.error) {
    throw new Error(data.error);
  }
  return JSON.stringify(data);
}

app.post("/api/summarize", async (req, res) => {
  try {
    const { mode, url, text } = req.body;
    let contentText = "";

    if (mode === "youtube") {
      const videoId = extractYouTubeId(url);
      if (!videoId) return res.status(400).json({ error: "رابط يوتيوب غير صالح" });
      const transcript = await YoutubeTranscript.fetchTranscript(videoId);
      contentText = transcript.map(s => s.text).join(" ");
    } else if (mode === "article") {
      const resp = await axios.get(url);
      const dom = new JSDOM(resp.data, { url });
      const reader = new Readability(dom.window.document);
      const parsed = reader.parse();
      contentText = parsed?.textContent || "";
    } else if (mode === "text") {
      contentText = text || "";
    } else {
      return res.status(400).json({ error: "وضع غير معروف" });
    }

    if (!contentText) {
      return res.status(400).json({ error: "لم يتم استخراج أي نص للتلخيص" });
    }

    // تقليم النص إذا طويل جدًا
    const MAX_CHARS = 3000;
    if (contentText.length > MAX_CHARS) {
      contentText = contentText.slice(0, MAX_CHARS);
    }

    const summary = await summarizeWithHF(contentText);
    res.json({ summary });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "خطأ في الخادم", details: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ الخادم يعمل على http://localhost:${PORT}`));
