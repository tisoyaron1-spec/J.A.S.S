// @ts-nocheck
const JASS_KEY_STORAGE = "JASS_GEMINI_API_KEY";

const JASS_CONFIG = {
  models: [
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
    "gemini-2.5-pro",
    "gemini-1.5-flash"
  ],
  requestTimeoutMs: 90000
};

const JASS_MEMORY = {
  recentTurns: []
};

function getJassApiKey() {
  return (localStorage.getItem(JASS_KEY_STORAGE) || "").trim();
}

function setJassApiKey(key) {
  if (key) {
    localStorage.setItem(JASS_KEY_STORAGE, key.trim());
  } else {
    localStorage.removeItem(JASS_KEY_STORAGE);
  }
}

async function getOwnerProfileContext() {
  try {
    if (typeof queryDatabase === "function") {
      const rows = await queryDatabase("SELECT * FROM Information;");
      if (rows && rows.length > 0) {
        return rows
          .map((r) =>
            Object.entries(r)
              .map(([k, v]) => `${k}: ${v}`)
              .join(", ")
          )
          .join("\n");
      }
    }
  } catch (e) {
    console.warn("Profile context read skipped:", e);
  }
  return "Names: AARON JAMES JOSE, Department: MAIN/ADMIN, Skill: EVERYTHING";
}

async function fetchLiveWebSearch(query) {
  const cleanQuery = query.replace(/^(search|find|look up)\s+/i, "").trim();
  const sources = [];
  let contextSnippet = "";

  try {
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
      cleanQuery
    )}&format=json&origin=*&srlimit=3`;
    const res = await fetch(searchUrl);
    const data = await res.json();

    if (data?.query?.search?.length) {
      for (const item of data.query.search) {
        const title = item.title;
        const pageUrl = `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`;
        const cleanSnippet = item.snippet.replace(/<\/?[^>]+(>|$)/g, "");
        sources.push({ title, url: pageUrl });
        contextSnippet += `- ${title}: ${cleanSnippet}\n`;
      }
    }
  } catch (err) {
    console.warn("Web search fetch failed:", err);
  }

  return { cleanQuery, sources, contextSnippet };
}

async function callGeminiWithFallback(systemInstruction, userPrompt, apiKey) {
  let lastError = "No models configured.";

  const contents = [
    ...JASS_MEMORY.recentTurns.slice(-6),
    {
      role: "user",
      parts: [{ text: userPrompt }]
    }
  ];

  for (const model of JASS_CONFIG.models) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), JASS_CONFIG.requestTimeoutMs);

      try {
        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(
          apiKey
        )}`;

        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            system_instruction: {
              parts: [{ text: systemInstruction }]
            },
            contents,
            generationConfig: {
              temperature: 0.7,
              maxOutputTokens: 65536
            }
          })
        });

        clearTimeout(timer);

        const data = await response.json();
        if (!response.ok) {
          lastError = data?.error?.message || `HTTP ${response.status} on ${model}`;
          if (response.status === 503 || /high demand|overloaded/i.test(lastError)) {
            await new Promise((r) => setTimeout(r, 2000));
            continue;
          }
          break;
        }

        const candidate = data?.candidates?.[0];
        const replyText = candidate?.content?.parts?.map((p) => p.text || "").join("");
        if (replyText) {
          const cleanOut = replyText.trim();
          JASS_MEMORY.recentTurns.push(
            { role: "user", parts: [{ text: userPrompt }] },
            { role: "model", parts: [{ text: cleanOut.slice(0, 4000) }] }
          );
          const wasTruncated = candidate?.finishReason === "MAX_TOKENS";
          return wasTruncated ? `${cleanOut}\n\n[TRUNCATED_MAX_TOKENS]` : cleanOut;
        }
      } catch (err) {
        clearTimeout(timer);
        if (err.name === "AbortError") {
          lastError = `${model} timed out after ${JASS_CONFIG.requestTimeoutMs / 1000}s`;
        } else {
          lastError = err.message || String(err);
        }
        break;
      }
    }
  }

  throw new Error(lastError);
}

async function askJASS(prompt) {
  const lower = prompt.toLowerCase().trim();
  let finalReply = { text: "", sources: [], media: null };

  try {
    if (lower === "system check" || lower === "status") {
      const tables = typeof getTables === "function" ? await getTables() : ["Information", "History"];
      const logs = typeof getHistory === "function" ? await getHistory(100) : [];
      finalReply.text = `All systems online, AARON JAMES JOSE. Jose Assistant Security System active. Database tables: ${tables.join(
        ", "
      )}. Saved memory records: ${logs.length}.`;
    } else if (lower === "my info" || lower === "who is your owner" || lower === "profile") {
      const profile = await getOwnerProfileContext();
      finalReply.text = `My owner and developer is AARON JAMES JOSE.\n\nFull Database Profile:\n${profile
        .split(", ")
        .map((f) => `• ${f}`)
        .join("\n")}`;
    } else if (/^(create|generate|make)\s+(an?\s+)?image\s+(of\s+)?/i.test(lower)) {
      const subject =
        prompt.replace(/^(create|generate|make)\s+(an?\s+)?image\s+(of\s+)?/i, "").trim() ||
        "futuristic blue arc reactor";
      const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(
        subject
      )}?width=800&height=600&nologo=true`;
      finalReply.text = `Visual matrix synthesized for: "${subject}". View or download the render in the Creation & Search Studio below.`;
      finalReply.media = { type: "image", url: imageUrl, subject };
    } else if (/^(create|generate|make)\s+(a\s+)?video\s+(of\s+)?/i.test(lower)) {
      const subject =
        prompt.replace(/^(create|generate|make)\s+(a\s+)?video\s+(of\s+)?/i, "").trim() ||
        "glowing cybernetic core";
      const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(
        subject
      )}?width=640&height=360&nologo=true`;
      finalReply.text = `Motion video synthesizer initialized for: "${subject}". Use EXPORT VIDEO (.WEBM) in the studio below to save the clip.`;
      finalReply.media = { type: "video", url: imageUrl, subject };
    } else {
      const apiKey = getJassApiKey();
      if (!apiKey) {
        finalReply.text =
          "AI Core Standby: Tap 'SET API KEY' in the top header bar to enter your Gemini API key (saved locally in your browser). Built-in commands like 'system check', 'my info', 'create an image of ...', and 'create a video of ...' work right now!";
      } else {
        const ownerContext = await getOwnerProfileContext();
        let webContext = "";

        if (lower.startsWith("search ") || lower.startsWith("find ") || lower.startsWith("look up ")) {
          const searchResult = await fetchLiveWebSearch(prompt);
          finalReply.sources = searchResult.sources;
          if (searchResult.contextSnippet) {
            webContext = `\n\nLive Web Search Context:\n${searchResult.contextSnippet}`;
          }
        }

        const systemPrompt = `You are J.A.S.S (Jose Assistant Security System), a helpful, loyal AI assistant inspired by J.A.R.V.I.S., created by your owner and developer Aaron James Jose.
Owner Database Profile:
${ownerContext}

CRITICAL CODE & FILE GENERATION RULES:
1. NEVER truncate code, NEVER skip sections with "// TODO", "// rest of code here", or placeholders. Always write 100% complete, runnable, production-ready code from start to finish.
2. When building a web app or dashboard that uses HTML, CSS, and JavaScript:
   - Either provide a complete self-contained single-file HTML document (with <style> and <script> inside) OR provide separate, complete fenced code blocks (\`\`\`html, \`\`\`css, \`\`\`javascript) if multiple files are requested.
3. Support ALL programming languages (HTML, CSS, JavaScript, TypeScript, Python, C#, PHP, SQL, Java, C++, C, Go, Rust, Kotlin, Swift, Dart, Bash, PowerShell, JSON, CSV). Always wrap each file in its own fenced code block with the exact language tag (e.g., \`\`\`python, \`\`\`csharp, \`\`\`php, \`\`\`sql).
4. When asked to generate a PDF, report, or study guide, write clean, well-structured plain text with clear headings and bullet points so the PDF exporter formats it cleanly.${webContext}`;

        finalReply.text = await callGeminiWithFallback(systemPrompt, prompt, apiKey);
      }
    }
  } catch (err) {
    finalReply.text = `AI Core Error: ${err.message}`;
  }

  try {
    if (typeof saveHistory === "function") {
      await saveHistory(prompt, finalReply.text);
    }
  } catch (e) {
    console.warn("History save failed:", e);
  }

  return finalReply;
}

window.getJassApiKey = getJassApiKey;
window.setJassApiKey = setJassApiKey;
window.askJASS = askJASS;
