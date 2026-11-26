// @ts-nocheck
const JASS_BODY = {
  lastGeneratedCode: "",
  lastRawText: "",
  lastPrompt: "",
  lastFileName: "jass_output.txt",
  lastImageUrl: "",
  extractedFiles: [],
  videoAnimFrame: null
};

function detectBodyIntent(prompt) {
  const lower = prompt.toLowerCase().trim();
  const isSearch =
    lower.startsWith("search ") ||
    lower.startsWith("find ") ||
    lower.startsWith("look up ") ||
    lower.includes("latest") ||
    lower.includes("news");

  const isCreate =
    /^(create|generate|build|write|make|code|export|draft|continue|act as)\b/i.test(lower);

  const wantsPdf = /\bpdf\b/i.test(lower);

  return { isSearch, isCreate, wantsPdf };
}

function getExtensionForLang(lang) {
  const extMap = {
    html: "html",
    css: "css",
    javascript: "js",
    js: "js",
    typescript: "ts",
    ts: "ts",
    python: "py",
    py: "py",
    csharp: "cs",
    "c#": "cs",
    cs: "cs",
    cpp: "cpp",
    "c++": "cpp",
    c: "c",
    java: "java",
    php: "php",
    sql: "sql",
    json: "json",
    xml: "xml",
    bash: "sh",
    sh: "sh",
    powershell: "ps1",
    ps1: "ps1",
    ruby: "rb",
    go: "go",
    rust: "rs",
    kotlin: "kt",
    swift: "swift",
    dart: "dart",
    csv: "csv",
    markdown: "md",
    md: "md"
  };
  return extMap[lang] || (lang.replace(/[^a-z0-9]/g, "") || "txt");
}

function extractAllGeneratedAssets(text, prompt = "") {
  const regex = /```([a-zA-Z0-9_+#.-]*)\n([\s\S]*?)(?:```|$)/g;
  const files = [];
  let match;
  let index = 1;

  while ((match = regex.exec(text)) !== null) {
    const lang = (match[1] || "txt").toLowerCase().trim();
    const code = match[2].trim();
    if (!code) continue;

    const ext = getExtensionForLang(lang);
    const defaultNames = {
      html: "index.html",
      css: "style.css",
      js: "script.js",
      py: "main.py",
      cs: "Program.cs",
      php: "index.php",
      sql: "schema.sql",
      java: "Main.java",
      cpp: "main.cpp"
    };

    const fileName =
      files.some((f) => f.fileName === (defaultNames[ext] || `file_${index}.${ext}`))
        ? `jass_${index}.${ext}`
        : defaultNames[ext] || `jass_${index}.${ext}`;

    files.push({
      lang: lang || "code",
      ext,
      code,
      fileName
    });
    index++;
  }

  if (files.length > 0) {
    return {
      hasCode: true,
      files,
      primary: files[0]
    };
  }

  const extRequest = prompt.match(/\.(txt|md|csv|json|xml|html|py|js|cs|php|sql)\b/i);
  const customExt = extRequest ? extRequest[1].toLowerCase() : "txt";
  const single = {
    lang: customExt,
    ext: customExt,
    code: text.replace("[TRUNCATED_MAX_TOKENS]", "").trim(),
    fileName: `jass_document.${customExt}`
  };

  return {
    hasCode: false,
    files: [single],
    primary: single
  };
}

function renderBodyWorkspace(prompt, reply) {
  const studioBox = document.getElementById("bodyStudio");
  const studioBadge = document.getElementById("studioBadge");
  const studioContent = document.getElementById("studioContent");
  const studioActions = document.getElementById("studioActions");

  if (!studioBox || !studioContent) return;

  if (JASS_BODY.videoAnimFrame) {
    cancelAnimationFrame(JASS_BODY.videoAnimFrame);
    JASS_BODY.videoAnimFrame = null;
  }

  const wasTruncated = reply.text.includes("[TRUNCATED_MAX_TOKENS]");
  const cleanReplyText = reply.text.replace("[TRUNCATED_MAX_TOKENS]", "").trim();

  JASS_BODY.lastRawText = cleanReplyText;
  JASS_BODY.lastPrompt = prompt;

  if (reply.media && reply.media.type === "image") {
    JASS_BODY.lastImageUrl = reply.media.url;
    studioBadge.textContent = "IMAGE RENDER";
    studioContent.innerHTML = `
      <div style="text-align:center;">
        <div id="imgLoader" style="color:#38bdf8; font-size:0.78rem; padding:1rem;">Rendering visual matrix...</div>
        <img
          src="${reply.media.url}"
          alt="${escapeHtml(reply.media.subject)}"
          onload="document.getElementById('imgLoader').style.display='none';"
          style="max-width:100%; border-radius:8px; border:1px solid rgba(56,189,248,0.4); display:block; margin:0 auto;"
        />
      </div>
    `;
    studioActions.innerHTML = `
      <a href="${reply.media.url}" target="_blank" class="btn-sm" style="text-decoration:none;">OPEN FULL IMAGE</a>
      <button class="btn-sm" onclick="downloadGeneratedImage()">SAVE PHOTO (.PNG)</button>
    `;
    return;
  }

  if (reply.media && reply.media.type === "video") {
    JASS_BODY.lastImageUrl = reply.media.url;
    studioBadge.textContent = "MOTION VIDEO";
    studioContent.innerHTML = `
      <div style="text-align:center;">
        <canvas id="jassVideoCanvas" width="640" height="360" style="width:100%; border-radius:8px; border:1px solid rgba(56,189,248,0.45); background:#030712;"></canvas>
      </div>
    `;
    studioActions.innerHTML = `
      <button class="btn-sm" style="border-color:#10b981; color:#10b981;" onclick="recordAndDownloadVideo()">EXPORT VIDEO (.WEBM)</button>
    `;
    startMotionVideoCanvas(reply.media.url, reply.media.subject);
    return;
  }

  const { isSearch, isCreate, wantsPdf } = detectBodyIntent(prompt);
  const extracted = extractAllGeneratedAssets(cleanReplyText, prompt);

  JASS_BODY.extractedFiles = extracted.files;
  JASS_BODY.lastGeneratedCode = extracted.primary.code;
  JASS_BODY.lastFileName = extracted.primary.fileName;

  if (isSearch && reply.sources && reply.sources.length) {
    studioBadge.textContent = "WEB INTEL";
    studioContent.innerHTML = `
      <div style="color:#7dd3fc; font-size:0.75rem; margin-bottom:0.5rem;">
        LIVE SEARCH RESULTS FOR: "${escapeHtml(prompt.toUpperCase())}"
      </div>
      ${reply.sources
        .map(
          (s, idx) => `
          <div style="border:1px solid rgba(56,189,248,0.25); background:rgba(5,10,22,0.85); padding:0.6rem; border-radius:6px; margin-bottom:0.45rem;">
            <div style="font-size:0.72rem; color:#64748b;">SOURCE #${idx + 1}</div>
            <a href="${s.url}" target="_blank" style="color:#38bdf8; font-weight:bold; text-decoration:none; font-size:0.82rem;">
              ${escapeHtml(s.title)} ↗
            </a>
          </div>`
        )
        .join("")}
    `;
    studioActions.innerHTML = `
      <button class="btn-sm" onclick="copyBodyAsset()">COPY SUMMARY</button>
      <button class="btn-sm" style="border-color:#38bdf8; color:#38bdf8;" onclick="downloadAsPdf()">EXPORT .PDF</button>
      <button class="btn-sm" onclick="downloadBodyAsset()">SAVE .MD</button>
    `;
    return;
  }

  if (isCreate || extracted.hasCode || wantsPdf) {
    const langs = [...new Set(extracted.files.map((f) => f.lang.toUpperCase()))].join(" + ");
    studioBadge.textContent = wantsPdf
      ? "PDF DOCUMENT"
      : extracted.hasCode
      ? `${langs} (${extracted.files.length} FILE${extracted.files.length > 1 ? "S" : ""})`
      : "FILE ARTIFACT";

    if (extracted.files.length > 1) {
      studioContent.innerHTML = extracted.files
        .map(
          (f, idx) => `
          <div style="margin-bottom:0.85rem; border:1px solid rgba(56,189,248,0.3); border-radius:6px; padding:0.55rem; background:rgba(5,10,22,0.85);">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.4rem; border-bottom:1px solid rgba(56,189,248,0.18); padding-bottom:0.3rem;">
              <span style="color:#38bdf8; font-size:0.74rem; font-weight:bold;">FILE #${idx + 1}: ${escapeHtml(f.fileName)} (${escapeHtml(f.lang.toUpperCase())})</span>
              <button class="btn-sm" onclick="downloadSpecificFile(${idx})">SAVE ${escapeHtml(f.fileName)}</button>
            </div>
            <pre style="margin:0; white-space:pre-wrap; font-size:0.78rem; color:#e2e8f0; max-height:170px; overflow-y:auto;">${escapeHtml(f.code)}</pre>
          </div>`
        )
        .join("");
    } else {
      studioContent.innerHTML = `<pre style="margin:0; white-space:pre-wrap; font-size:0.8rem; color:#e2e8f0;">${escapeHtml(extracted.primary.code)}</pre>`;
    }

    const hasWebBundle = extracted.files.some((f) => f.ext === "html");
    const previewBtn = hasWebBundle
      ? `<button class="btn-sm" style="border-color:#10b981; color:#10b981;" onclick="previewCombinedWebApp()">RUN LIVE PREVIEW</button>`
      : "";

    const fileButtons = extracted.files
      .map(
        (f, idx) =>
          `<button class="btn-sm" onclick="downloadSpecificFile(${idx})">SAVE ${escapeHtml(f.fileName)}</button>`
      )
      .join("");

    const continueBtn = wasTruncated
      ? `<button class="btn-sm" style="border-color:#f59e0b; color:#fde68a;" onclick="continueInterruptedCode()">CONTINUE CODE ➔</button>`
      : "";

    studioActions.innerHTML = `
      ${previewBtn}
      ${fileButtons}
      <button class="btn-sm" style="border-color:#38bdf8; color:#38bdf8;" onclick="downloadAsPdf()">DOWNLOAD .PDF</button>
      <button class="btn-sm" onclick="copyAllBodyAssets()">COPY ALL</button>
      ${continueBtn}
    `;
    return;
  }

  studioBadge.textContent = "ACTIVE OUTPUT";
  studioContent.innerHTML = `<div style="font-size:0.8rem; color:#cbd5e1; white-space:pre-wrap;">${escapeHtml(cleanReplyText)}</div>`;
  studioActions.innerHTML = `
    <button class="btn-sm" onclick="copyBodyAsset()">COPY</button>
    <button class="btn-sm" style="border-color:#38bdf8; color:#38bdf8;" onclick="downloadAsPdf()">SAVE .PDF</button>
    <button class="btn-sm" onclick="downloadBodyAsset()">SAVE .TXT</button>
  `;
}

function downloadSpecificFile(idx) {
  const file = JASS_BODY.extractedFiles[idx];
  if (!file) return;
  const blob = new Blob([file.code], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.fileName;
  a.click();
  URL.revokeObjectURL(url);
  if (typeof logEvent === "function") logEvent(`Downloaded ${file.fileName}.`);
}

function previewCombinedWebApp() {
  const htmlFile = JASS_BODY.extractedFiles.find((f) => f.ext === "html");
  if (!htmlFile) return;

  let fullHtml = htmlFile.code;
  const cssFiles = JASS_BODY.extractedFiles.filter((f) => f.ext === "css");
  const jsFiles = JASS_BODY.extractedFiles.filter((f) => f.ext === "js");

  if (cssFiles.length) {
    const cssTag = `<style>\n${cssFiles.map((c) => c.code).join("\n")}\n</style>`;
    fullHtml = fullHtml.includes("</head>")
      ? fullHtml.replace("</head>", `${cssTag}\n</head>`)
      : `${cssTag}\n${fullHtml}`;
  }

  if (jsFiles.length) {
    const jsTag = `<script>\n${jsFiles.map((j) => j.code).join("\n")}\n</script>`;
    fullHtml = fullHtml.includes("</body>")
      ? fullHtml.replace("</body>", `${jsTag}\n</body>`)
      : `${fullHtml}\n${jsTag}`;
  }

  const win = window.open("", "_blank");
  if (win) {
    win.document.open();
    win.document.write(fullHtml);
    win.document.close();
  }
}

function continueInterruptedCode() {
  const tail = JASS_BODY.lastRawText.slice(-300);
  const cmdInput = document.getElementById("cmdInput");
  if (cmdInput && typeof sendCommand === "function") {
    cmdInput.value = `Continue writing the rest of the code starting right from where it stopped here:\n${tail}`;
    sendCommand();
  }
}

function copyAllBodyAssets() {
  const textToCopy =
    JASS_BODY.extractedFiles.length > 1
      ? JASS_BODY.extractedFiles.map((f) => `/* === ${f.fileName} === */\n${f.code}`).join("\n\n")
      : JASS_BODY.lastGeneratedCode || JASS_BODY.lastRawText;
  if (!textToCopy) return;
  navigator.clipboard.writeText(textToCopy);
  if (typeof logEvent === "function") logEvent("All generated code copied to clipboard.");
}

function downloadAsPdf() {
  const content = JASS_BODY.lastRawText || JASS_BODY.lastGeneratedCode;
  if (!content) return;

  if (!window.jspdf || !window.jspdf.jsPDF) {
    alert("PDF library still loading. Please check internet connection and try again.");
    return;
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "pt", format: "a4" });

  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text("J.A.S.S // GENERATED DOCUMENT", 40, 45);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(100);
  doc.text(`Generated: ${new Date().toLocaleString()}`, 40, 60);

  doc.setTextColor(20);
  doc.setFontSize(11);
  const cleanText = content.replace(/```[a-zA-Z0-9_+#.-]*\n?/g, "").replace(/```/g, "");
  const lines = doc.splitTextToSize(cleanText, 515);

  let y = 85;
  const pageHeight = doc.internal.pageSize.getHeight();
  for (let i = 0; i < lines.length; i++) {
    if (y > pageHeight - 45) {
      doc.addPage();
      y = 45;
    }
    doc.text(lines[i], 40, y);
    y += 15;
  }

  doc.save("jass_document.pdf");
  if (typeof logEvent === "function") logEvent("Exported jass_document.pdf.");
}

function startMotionVideoCanvas(imageUrl, subject) {
  const canvas = document.getElementById("jassVideoCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = imageUrl;

  let startTime = performance.now();

  function drawFrame(now) {
    const t = (now - startTime) / 1000;
    ctx.fillStyle = "#030712";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (img.complete && img.naturalWidth > 0) {
      const scale = 1.05 + 0.08 * Math.sin(t * 0.8);
      const panX = Math.sin(t * 0.5) * 18;
      const panY = Math.cos(t * 0.4) * 10;
      const w = canvas.width * scale;
      const h = canvas.height * scale;
      const x = (canvas.width - w) / 2 + panX;
      const y = (canvas.height - h) / 2 + panY;
      ctx.drawImage(img, x, y, w, h);
    } else {
      ctx.fillStyle = "#38bdf8";
      ctx.font = "16px monospace";
      ctx.fillText("SYNTHESIZING MOTION FRAMES...", 180, 180);
    }

    ctx.fillStyle = "rgba(56, 189, 248, 0.08)";
    const scanY = (t * 90) % canvas.height;
    ctx.fillRect(0, scanY, canvas.width, 3);

    ctx.fillStyle = "rgba(3, 7, 18, 0.75)";
    ctx.fillRect(10, canvas.height - 32, canvas.width - 20, 22);
    ctx.fillStyle = "#7dd3fc";
    ctx.font = "12px monospace";
    ctx.fillText(`J.A.S.S MOTION // ${subject.toUpperCase().slice(0, 38)} // REC ${t.toFixed(1)}s`, 18, canvas.height - 17);

    JASS_BODY.videoAnimFrame = requestAnimationFrame(drawFrame);
  }

  JASS_BODY.videoAnimFrame = requestAnimationFrame(drawFrame);
}

function recordAndDownloadVideo() {
  const canvas = document.getElementById("jassVideoCanvas");
  if (!canvas || !canvas.captureStream) return;
  if (typeof logEvent === "function") logEvent("Recording 4-second .webm video clip...");

  const stream = canvas.captureStream(30);
  const recorder = new MediaRecorder(stream, { mimeType: "video/webm" });
  const chunks = [];

  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  recorder.onstop = () => {
    const blob = new Blob(chunks, { type: "video/webm" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "jass_motion_clip.webm";
    a.click();
    URL.revokeObjectURL(url);
    if (typeof logEvent === "function") logEvent("Exported jass_motion_clip.webm.");
  };

  recorder.start();
  setTimeout(() => recorder.stop(), 4000);
}

async function downloadGeneratedImage() {
  if (!JASS_BODY.lastImageUrl) return;
  try {
    const res = await fetch(JASS_BODY.lastImageUrl);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "jass_generated_image.png";
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    window.open(JASS_BODY.lastImageUrl, "_blank");
  }
}

function copyBodyAsset() {
  if (!JASS_BODY.lastGeneratedCode) return;
  navigator.clipboard.writeText(JASS_BODY.lastGeneratedCode);
  if (typeof logEvent === "function") logEvent("Artifact copied to clipboard.");
}

function downloadBodyAsset() {
  if (!JASS_BODY.lastGeneratedCode) return;
  const blob = new Blob([JASS_BODY.lastGeneratedCode], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = JASS_BODY.lastFileName;
  a.click();
  URL.revokeObjectURL(url);
  if (typeof logEvent === "function") logEvent(`Downloaded ${JASS_BODY.lastFileName}.`);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

window.renderBodyWorkspace = renderBodyWorkspace;
window.copyBodyAsset = copyBodyAsset;
window.copyAllBodyAssets = copyAllBodyAssets;
window.downloadBodyAsset = downloadBodyAsset;
window.downloadSpecificFile = downloadSpecificFile;
window.downloadAsPdf = downloadAsPdf;
window.previewCombinedWebApp = previewCombinedWebApp;
window.continueInterruptedCode = continueInterruptedCode;
window.downloadGeneratedImage = downloadGeneratedImage;
window.recordAndDownloadVideo = recordAndDownloadVideo;
