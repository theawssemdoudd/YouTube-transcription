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

/**
 * استخراج ID من رابط يوتيوب
 */
function extractYouTubeId(url) {
  try {
    const u = new URL(url);
    if (u.hostname.includes("youtu.be")) return u.pathname.slice(1);
    if (u.searchParams.has("v")) return u.searchParams.get("v");
    return null;
  } catch {
    return null;
  }
}

/**
 * API الرئيسي
 */
app.post("/api/summarize", async (req, res) => {
  try {
    const { mode, url, text } = req.body;
    let contentText = "";

    if (mode === "youtube") {
      const videoId = extractYouTubeId(url);
      console.log("🎬 VideoID:", videoId);

      if (!videoId) {
        return res.status(400).json({ error: "Invalid YouTube URL" });
      }

      const transcript = await YoutubeTranscript.fetchTranscript(videoId);

      if (!transcript || transcript.length === 0) {
        return res.status(400).json({
          error: "This video has no subtitles available.",
        });
      }

      contentText = transcript.map((s) => s.text).join(" ");
    } 
    
    else if (mode === "article") {
      const resp = await axios.get(url);
      const dom = new JSDOM(resp.data, { url });
      const reader = new Readability(dom.window.document);
      const parsed = reader.parse();

      if (!parsed || !parsed.textContent) {
        return res.status(400).json({
          error: "Could not extract article text.",
        });
      }

      contentText = parsed.textContent;
    } 
    
    else if (mode === "text") {
      if (!text || text.trim().length === 0) {
        return res.status(400).json({ error: "No text provided." });
      }
      contentText = text;
    } 
    
    else {
      return res.status(400).json({ error: "Unknown mode" });
    }

    if (!contentText) {
      return res.status(400).json({
        error: "No text extracted",
        details: `Mode: ${mode}, URL: ${url || "N/A"}`,
      });
    }

    // ✅ حاليا نرجع النص كما هو (بدون AI)
    res.json({ transcript: contentText });
  } catch (err) {
    console.error("❌ API error:", err.message);
    res.status(500).json({
      error: "Server error",
      details: err.message,
    });
  }
});

/**
 * إصلاح خطأ "Cannot GET /"
 */
app.get("/", (req, res) => {
  res.sendFile("index.html", { root: "public" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`✅ Server running on http://localhost:${PORT}`)
);
