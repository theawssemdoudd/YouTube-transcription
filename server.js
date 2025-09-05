// server.js
import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import { YoutubeTranscript } from "youtube-transcript";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

const OPENAI_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_KEY) {
  console.warn("Warning: Set OPENAI_API_KEY environment variable before running.");
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

app.post("/api/summarize", async (req, res) => {
  try {
    const { mode, url, text } = req.body;
    if (!mode || (!url && !text)) {
      return res.status(400).json({ error: "mode and (url or text) required" });
    }

    let contentText = "";

    if (mode === "youtube") {
      const videoId = extractYouTubeId(url);
      if (!videoId) return res.status(400).json({ error: "Invalid YouTube URL" });

      // youtube-transcript package returns array of segments {text, duration, offset}
      const transcriptSegments = await YoutubeTranscript.fetchTranscript(videoId);
      contentText = transcriptSegments.map(s => s.text).join(" ");
      if (!contentText) return res.status(400).json({ error: "No transcript available for this video" });
    } else if (mode === "article") {
      // fetch article, parse text with Readability
      const resp = await fetch(url);
      if (!resp.ok) return res.status(400).json({ error: `Unable to fetch article: ${resp.status}` });
      const html = await resp.text();
      const dom = new JSDOM(html, { url });
      const reader = new Readability(dom.window.document);
      const parsed = reader.parse();
      contentText = (parsed && parsed.textContent) ? parsed.textContent : "";
      if (!contentText) return res.status(400).json({ error: "Couldn't extract article text" });
    } else if (mode === "text") {
      contentText = text || "";
    } else {
      return res.status(400).json({ error: "Unknown mode" });
    }

    // Truncate if extremely long (you should implement proper chunking for long texts)
    const MAX_CHARS = 20000;
    if (contentText.length > MAX_CHARS) {
      contentText = contentText.slice(0, MAX_CHARS) + "\n\n[TRUNCATED]";
    }

    // Build prompt for summarization
    const systemPrompt = `You are a helpful summarizer. Produce a clean structured summary with:
- Short headline (one line)
- 3–6 bullet points of main ideas (brief)
- A 2-4 sentence detailed summary
- (If applicable) key timestamps or action items.`;

    const userPrompt = `Summarize the following content. Keep it clear and concise.\n\nContent:\n${contentText}`;

    if (!OPENAI_KEY) {
      return res.status(500).json({ error: "Server missing OPENAI_API_KEY env variable" });
    }

    // Call OpenAI Chat Completions
    const openaiResp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini", // change if needed
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        max_tokens: 600,
        temperature: 0.2
      })
    });

    if (!openaiResp.ok) {
      const errText = await openaiResp.text();
      console.error("OpenAI error:", errText);
      return res.status(500).json({ error: "OpenAI API error", details: errText });
    }

    const openaiData = await openaiResp.json();
    const summary = openaiData.choices?.[0]?.message?.content || "";

    res.json({ summary });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error", details: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on http://localhost:${PORT}`));
