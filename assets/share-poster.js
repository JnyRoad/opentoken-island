(function attachSharePoster(root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.OpenTokenSharePoster = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function createSharePosterApi(root) {
  const WIDTH = 1080;
  const HEIGHT = 1920;
  const TEMPLATE_URL = "./assets/share-poster-template.html";
  const PNG_TYPE = "image/png";
  const SVG_TYPE = "image/svg+xml;charset=utf-8";

  const TOKEN_IDENTITIES = [
    {
      min: 0,
      title: "炼气期",
      shortTitle: "炼气期",
      description: "刚开始把 AI 纳入日常修炼。",
    },
    {
      min: 10_000_000,
      title: "筑基期",
      shortTitle: "筑基期",
      description: "开始稳定用 AI 打底，把问题拆成可执行路径。",
    },
    {
      min: 100_000_000,
      title: "金丹期",
      shortTitle: "金丹期",
      description: "已经能把大量 token 炼成方案、代码和文档。",
    },
    {
      min: 500_000_000,
      title: "元婴期",
      shortTitle: "元婴期",
      description: "高强度调用 AI，形成持续交付节奏。",
    },
    {
      min: 1_500_000_000,
      title: "化神期",
      shortTitle: "化神期",
      description: "把复杂问题拆解、验证、迭代到可落地。",
    },
    {
      min: 4_000_000_000,
      title: "大乘期",
      shortTitle: "大乘期",
      description: "进入顶级消耗区，距离渡劫仍有余量。",
    },
    {
      min: 10_000_000_000,
      title: "渡劫期",
      shortTitle: "渡劫期",
      description: "单日百亿 token 的终局境界。",
    },
  ];

  function readBundledTemplate() {
    if (typeof require !== "function") return "";
    try {
      const fs = require("fs");
      const path = require("path");
      return fs.readFileSync(path.join(__dirname, "share-poster-template.html"), "utf8");
    } catch {
      return "";
    }
  }

  const DEFAULT_TEMPLATE_HTML = readBundledTemplate();

  function logPosterEvent(event, details = {}) {
    if (root && typeof root.OpenTokenIslandLogEvent === "function") {
      root.OpenTokenIslandLogEvent(event, details);
    }
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#39;",
    }[char]));
  }

  function numberOrZero(value) {
    const number = Number(value || 0);
    return Number.isFinite(number) ? number : 0;
  }

  function formatCount(value) {
    return Math.round(numberOrZero(value)).toLocaleString("en-US");
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function fieldValue(summary, options, name) {
    const value = summary?.[name];
    return value === undefined || value === null || value === "" ? options?.[name] : value;
  }

  function getTokenIdentity(totalTokens) {
    const total = Math.max(0, numberOrZero(totalTokens));
    let index = 0;
    for (let i = 0; i < TOKEN_IDENTITIES.length; i += 1) {
      if (total >= TOKEN_IDENTITIES[i].min) index = i;
    }
    const identity = TOKEN_IDENTITIES[index];
    const next = TOKEN_IDENTITIES[index + 1] || null;
    const rangeProgress = next
      ? clamp((total - identity.min) / (next.min - identity.min), 0, 1)
      : 1;
    return {
      ...identity,
      index,
      next,
      markerProgress: index / (TOKEN_IDENTITIES.length - 1),
      rangeProgress,
      total,
    };
  }

  function describeDelta(rankDelta) {
    const delta = numberOrZero(rankDelta);
    if (delta > 0) return { label: String(delta), icon: "up" };
    if (delta < 0) return { label: String(-delta), icon: "down" };
    return null;
  }

  function buildRankDeltaBadge(rankDelta, rankEstimated) {
    if (rankEstimated) return "";
    const delta = describeDelta(rankDelta);
    if (!delta) return "";
    const path = delta.icon === "up"
      ? "M17 5 L29 25 H5 Z"
      : "M17 29 L5 9 H29 Z";
    return `<span class="delta ${escapeHtml(delta.icon)}">
            <svg width="34" height="34" viewBox="0 0 34 34"><path d="${path}" fill="currentColor"/></svg>
            ${escapeHtml(delta.label)}
          </span>`;
  }

  function tokenUnitFor(label) {
    const text = String(label || "");
    return text && text !== "--" && text !== "榜首" && text !== "等待确认" ? "tokens" : "";
  }

  function scaleProgress(identity) {
    const progress = (identity.index + identity.rangeProgress) / (TOKEN_IDENTITIES.length - 1);
    return String(Math.round(clamp(progress, 0, 1) * 1000) / 10);
  }

  function posterTextModel(summary = {}, options = {}) {
    const total = Math.max(0, numberOrZero(summary?.total));
    const identity = getTokenIdentity(total);
    const rankValue = fieldValue(summary, options, "rank");
    const rank = rankValue ? Number(rankValue) : null;
    const hasRank = Number.isFinite(rank) && rank > 0;
    const rankEstimated = Boolean(fieldValue(summary, options, "rankEstimated"));
    const rankLabel = hasRank
      ? fieldValue(summary, options, "rankLabel") || `#${rank}`
      : "#--";
    const gapToPrevious = hasRank ? (rank === 1 ? "榜首" : fieldValue(summary, options, "gapToPreviousLabel") || "--") : "等待确认";
    const leadOverNext = hasRank ? fieldValue(summary, options, "leadOverNextLabel") || "--" : "等待确认";
    const totalLabel = summary?.totalLabel && summary.totalLabel !== "--" ? String(summary.totalLabel) : formatCount(total);
    return {
      total,
      identity,
      rank,
      hasRank,
      rankEstimated,
      rankLabel: String(rankLabel),
      gapToPrevious: String(gapToPrevious),
      leadOverNext: String(leadOverNext),
      totalLabel,
      scaleProgress: scaleProgress(identity),
    };
  }

  function templateValueMap(summary = {}, options = {}) {
    const model = posterTextModel(summary, options);
    const replacements = {
      REALM_TITLE: escapeHtml(model.identity.title),
      REALM_DESCRIPTION: escapeHtml(model.identity.description),
      RANK_LABEL: escapeHtml(model.rankLabel),
      RANK_DELTA_BADGE: buildRankDeltaBadge(fieldValue(summary, options, "rankDelta"), model.rankEstimated),
      GAP_TO_PREVIOUS: escapeHtml(model.gapToPrevious),
      GAP_TO_PREVIOUS_UNIT: escapeHtml(tokenUnitFor(model.gapToPrevious)),
      LEAD_OVER_NEXT: escapeHtml(model.leadOverNext),
      LEAD_OVER_NEXT_UNIT: escapeHtml(tokenUnitFor(model.leadOverNext)),
      TOTAL_LABEL: escapeHtml(model.totalLabel),
      SCALE_PROGRESS: model.scaleProgress,
    };

    TOKEN_IDENTITIES.forEach((tier, index) => {
      replacements[`NODE_${index}_CLASS`] = index < model.identity.index
        ? "done"
        : index === model.identity.index
          ? "cur"
          : "future";
      replacements[`TICK_${index}_CLASS`] = index === model.identity.index ? "cur" : "";
      replacements[`TIER_${index}_TITLE`] = escapeHtml(tier.title);
    });

    return replacements;
  }

  function replaceTemplateValues(templateHtml, values) {
    let html = templateHtml;
    Object.entries(values).forEach(([name, value]) => {
      html = html.split(`{{${name}}}`).join(String(value));
    });
    if (/{{[A-Z0-9_]+}}/.test(html)) {
      throw new Error("Share poster template has unresolved placeholders");
    }
    return html;
  }

  function requireTemplateHtml(templateHtml) {
    const html = templateHtml || DEFAULT_TEMPLATE_HTML;
    if (!html) throw new Error("Share poster template is unavailable");
    return html;
  }

  function buildSharePosterHtml(summary, options = {}) {
    const templateHtml = requireTemplateHtml(options.templateHtml);
    return replaceTemplateValues(templateHtml, templateValueMap(summary, options));
  }

  function extractBetween(source, startMarker, endMarker) {
    const start = source.indexOf(startMarker);
    const end = source.indexOf(endMarker);
    if (start < 0 || end < 0 || end <= start) {
      throw new Error("Share poster template markers are missing");
    }
    return source.slice(start + startMarker.length, end).trim();
  }

  function extractTemplateStyle(html) {
    const match = html.match(/<style>([\s\S]*?)<\/style>/i);
    if (!match) throw new Error("Share poster template style is missing");
    return match[1];
  }

  function buildSharePosterSvg(summary, options = {}) {
    const html = buildSharePosterHtml(summary, options);
    const style = extractTemplateStyle(html);
    const fragment = extractBetween(html, "<!-- SHARE_POSTER_FRAGMENT_START -->", "<!-- SHARE_POSTER_FRAGMENT_END -->");
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <foreignObject width="${WIDTH}" height="${HEIGHT}">
    <div xmlns="http://www.w3.org/1999/xhtml">
      <style>${style}</style>
      ${fragment}
    </div>
  </foreignObject>
</svg>`;
  }

  async function loadPosterTemplateHtml(templateUrl = TEMPLATE_URL) {
    const response = await fetch(templateUrl, { cache: "force-cache" });
    if (!response.ok) throw new Error(`Failed to load poster template: ${response.status}`);
    return response.text();
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("Failed to read logo asset"));
      reader.readAsDataURL(blob);
    });
  }

  async function loadLogoDataUrl(logoUrl = "./assets/scys/icon_topnav.png") {
    const response = await fetch(logoUrl, { cache: "force-cache" });
    if (!response.ok) throw new Error(`Failed to load poster logo: ${response.status}`);
    return blobToDataUrl(await response.blob());
  }

  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Failed to decode poster SVG"));
      image.src = url;
    });
  }

  async function svgToPngBlob(svg) {
    const url = URL.createObjectURL(new Blob([svg], { type: SVG_TYPE }));
    try {
      const image = await loadImage(url);
      const canvas = document.createElement("canvas");
      canvas.width = WIDTH;
      canvas.height = HEIGHT;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas is unavailable");
      context.drawImage(image, 0, 0, WIDTH, HEIGHT);
      return await new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
          if (blob) resolve(blob);
          else reject(new Error("Failed to render poster PNG"));
        }, PNG_TYPE);
      });
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function canvasDocument(options = {}) {
    return options.document || (root && root.document) || null;
  }

  function font(size, weight = 700) {
    return `${weight} ${size}px "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", -apple-system, BlinkMacSystemFont, system-ui, sans-serif`;
  }

  function roundedRect(context, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    context.beginPath();
    context.moveTo(x + r, y);
    context.lineTo(x + width - r, y);
    context.quadraticCurveTo(x + width, y, x + width, y + r);
    context.lineTo(x + width, y + height - r);
    context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    context.lineTo(x + r, y + height);
    context.quadraticCurveTo(x, y + height, x, y + height - r);
    context.lineTo(x, y + r);
    context.quadraticCurveTo(x, y, x + r, y);
    context.closePath();
  }

  function fillRoundRect(context, x, y, width, height, radius, fillStyle) {
    context.save();
    context.fillStyle = fillStyle;
    roundedRect(context, x, y, width, height, radius);
    context.fill();
    context.restore();
  }

  function strokeRoundRect(context, x, y, width, height, radius, strokeStyle, lineWidth = 1.5) {
    context.save();
    context.strokeStyle = strokeStyle;
    context.lineWidth = lineWidth;
    roundedRect(context, x, y, width, height, radius);
    context.stroke();
    context.restore();
  }

  function drawFittedText(context, text, x, y, options = {}) {
    const content = String(text ?? "");
    const weight = options.weight || 700;
    const minSize = options.minSize || 16;
    let size = options.size || 32;
    const maxWidth = options.maxWidth || WIDTH;
    context.textAlign = options.align || "left";
    context.textBaseline = options.baseline || "alphabetic";
    context.fillStyle = options.color || "#F7EFD6";
    context.font = font(size, weight);
    while (size > minSize && context.measureText(content).width > maxWidth) {
      size -= 2;
      context.font = font(size, weight);
    }
    context.fillText(content, x, y);
    return size;
  }

  function drawGrid(context) {
    context.save();
    context.globalAlpha = 0.18;
    context.strokeStyle = "rgba(215,239,229,.22)";
    context.lineWidth = 1;
    for (let x = 0; x <= WIDTH; x += 72) {
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, HEIGHT);
      context.stroke();
    }
    for (let y = 0; y <= HEIGHT; y += 72) {
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(WIDTH, y);
      context.stroke();
    }
    context.restore();
  }

  function drawRings(context) {
    context.save();
    context.strokeStyle = "rgba(215,239,229,.14)";
    [320, 215, 120].forEach((radius, index) => {
      context.globalAlpha = [0.8, 0.55, 0.4][index];
      context.lineWidth = 2;
      context.beginPath();
      context.arc(985, 150, radius, 0, Math.PI * 2);
      context.stroke();
    });
    context.restore();
  }

  function drawLogo(context) {
    const logoGradient = context.createLinearGradient(84, 96, 222, 234);
    logoGradient.addColorStop(0, "rgba(0,71,64,.92)");
    logoGradient.addColorStop(1, "rgba(0,46,42,.95)");
    fillRoundRect(context, 84, 96, 138, 138, 30, logoGradient);
    strokeRoundRect(context, 84, 96, 138, 138, 30, "rgba(215,239,229,.32)", 1.5);
    drawFittedText(context, "Open", 153, 166, {
      align: "center",
      baseline: "middle",
      color: "#F7EFD6",
      size: 36,
      weight: 900,
      maxWidth: 112,
    });
    drawFittedText(context, "Token", 153, 204, {
      align: "center",
      baseline: "middle",
      color: "#00A889",
      size: 36,
      weight: 900,
      maxWidth: 112,
    });
  }

  function drawPill(context, x, y, width, height, text) {
    fillRoundRect(context, x, y, width, height, 34, "rgba(0,71,64,.45)");
    strokeRoundRect(context, x, y, width, height, 34, "rgba(215,239,229,.2)", 1.5);
    context.save();
    context.fillStyle = "#00A889";
    context.beginPath();
    context.arc(x + 31, y + height / 2, 7.5, 0, Math.PI * 2);
    context.fill();
    context.restore();
    drawFittedText(context, text, x + 54, y + height / 2 + 1, {
      baseline: "middle",
      color: "#F7EFD6",
      size: 27,
      weight: 800,
      maxWidth: width - 80,
    });
  }

  function drawGapCard(context, x, y, width, label, value, unit, accent = false) {
    fillRoundRect(context, x, y, width, 170, 26, "rgba(0,71,64,.5)");
    strokeRoundRect(context, x, y, width, 170, 26, accent ? "rgba(0,168,137,.4)" : "rgba(215,239,229,.16)", 1.5);
    drawFittedText(context, label, x + 32, y + 50, {
      color: "#D7EFE5",
      size: 25,
      weight: 700,
      maxWidth: width - 64,
    });
    drawFittedText(context, value, x + 32, y + 124, {
      color: accent ? "#00A889" : "#F7EFD6",
      size: 62,
      minSize: 34,
      weight: 900,
      maxWidth: width - 92,
    });
    if (unit) {
      drawFittedText(context, unit, x + width - 36, y + 124, {
        align: "right",
        color: "#D7EFE5",
        size: 27,
        minSize: 18,
        weight: 700,
        maxWidth: 86,
      });
    }
  }

  function drawScale(context, model) {
    const y = 1448;
    drawFittedText(context, "修为境界", 84, y, {
      color: "#F7EFD6",
      size: 23,
      weight: 900,
      maxWidth: 300,
    });
    fillRoundRect(context, 84, y + 36, 912, 10, 6, "rgba(215,239,229,.2)");
    const progressWidth = clamp(Number(model.scaleProgress) || 0, 0, 100) / 100 * 912;
    const progressGradient = context.createLinearGradient(84, y + 36, 996, y + 36);
    progressGradient.addColorStop(0, "#00826F");
    progressGradient.addColorStop(1, "#00A889");
    fillRoundRect(context, 84, y + 36, progressWidth, 10, 6, progressGradient);

    TOKEN_IDENTITIES.forEach((tier, index) => {
      const x = 84 + (912 / (TOKEN_IDENTITIES.length - 1)) * index;
      const isCurrent = index === model.identity.index;
      const isDone = index < model.identity.index;
      context.save();
      context.fillStyle = isCurrent ? "#F7EFD6" : isDone ? "#00A889" : "rgba(215,239,229,.45)";
      context.beginPath();
      context.arc(x, y + 41, isCurrent ? 21 : 10, 0, Math.PI * 2);
      context.fill();
      context.restore();
      drawFittedText(context, tier.title, x, y + 98, {
        align: "center",
        color: isCurrent ? "#F7EFD6" : "#D7EFE5",
        size: isCurrent ? 28 : 23,
        minSize: 16,
        weight: isCurrent ? 900 : 800,
        maxWidth: 132,
      });
    });
  }

  function drawSharePosterCanvas(context, summary, options = {}) {
    const model = posterTextModel(summary, options);
    const bg = context.createLinearGradient(0, 0, WIDTH, HEIGHT);
    bg.addColorStop(0, "#004740");
    bg.addColorStop(0.52, "#00826F");
    bg.addColorStop(1, "#005B50");
    context.fillStyle = bg;
    context.fillRect(0, 0, WIDTH, HEIGHT);

    const topGlow = context.createRadialGradient(885, 115, 0, 885, 115, 760);
    topGlow.addColorStop(0, "rgba(0,168,137,.42)");
    topGlow.addColorStop(1, "rgba(0,168,137,0)");
    context.fillStyle = topGlow;
    context.fillRect(0, 0, WIDTH, HEIGHT);
    drawGrid(context);
    drawRings(context);

    drawLogo(context);
    drawFittedText(context, "AI TOKEN IDENTITY", 252, 138, {
      color: "#F7EFD6",
      size: 30,
      weight: 900,
      maxWidth: 520,
    });
    drawFittedText(context, "个人 AI 消耗画像 · 修为快照", 252, 184, {
      color: "#D7EFE5",
      size: 21,
      weight: 600,
      maxWidth: 560,
    });
    fillRoundRect(context, 854, 96, 142, 58, 30, "rgba(0,71,64,.6)");
    strokeRoundRect(context, 854, 96, 142, 58, 30, "rgba(215,239,229,.34)", 1.5);
    drawFittedText(context, "2026 版", 925, 126, {
      align: "center",
      baseline: "middle",
      color: "#F7EFD6",
      size: 24,
      weight: 900,
      maxWidth: 104,
    });

    drawPill(context, 84, 298, 348, 68, "我的 AI 修为，已修到");
    drawFittedText(context, model.identity.title, 84, 562, {
      color: "#F7EFD6",
      size: 224,
      minSize: 116,
      weight: 900,
      maxWidth: 912,
    });
    fillRoundRect(context, 88, 604, 172, 14, 8, "rgba(0,168,137,.9)");
    drawFittedText(context, model.identity.description, 84, 692, {
      color: "#D7EFE5",
      size: 38,
      minSize: 26,
      weight: 700,
      maxWidth: 912,
    });

    const rankGradient = context.createLinearGradient(84, 744, 996, 1102);
    rankGradient.addColorStop(0, "rgba(0,63,57,.92)");
    rankGradient.addColorStop(1, "rgba(0,46,42,.92)");
    fillRoundRect(context, 84, 744, 912, 358, 40, rankGradient);
    strokeRoundRect(context, 84, 744, 912, 358, 40, "rgba(215,239,229,.2)", 1.5);
    drawFittedText(context, "今日总榜排名", 136, 820, {
      color: "#D7EFE5",
      size: 24,
      weight: 800,
      maxWidth: 360,
    });
    drawFittedText(context, model.rankLabel, 136, 946, {
      color: "#F7EFD6",
      size: 136,
      minSize: 72,
      weight: 900,
      maxWidth: 430,
    });
    const delta = model.rankEstimated ? null : describeDelta(fieldValue(summary, options, "rankDelta"));
    if (delta) {
      const deltaText = `${delta.icon === "up" ? "+" : "-"}${delta.label}`;
      fillRoundRect(context, 564, 858, 142, 68, 24, delta.icon === "up" ? "rgba(0,168,137,.16)" : "rgba(215,239,229,.10)");
      strokeRoundRect(context, 564, 858, 142, 68, 24, delta.icon === "up" ? "rgba(0,168,137,.6)" : "rgba(215,239,229,.36)", 1.5);
      drawFittedText(context, deltaText, 635, 892, {
        align: "center",
        baseline: "middle",
        color: delta.icon === "up" ? "#00A889" : "#D7EFE5",
        size: 40,
        weight: 900,
        maxWidth: 100,
      });
    }
    drawGapCard(context, 136, 910, 380, "距上一名", model.gapToPrevious, tokenUnitFor(model.gapToPrevious), false);
    drawGapCard(context, 564, 910, 380, "领先下一名", model.leadOverNext, tokenUnitFor(model.leadOverNext), true);

    fillRoundRect(context, 84, 1132, 912, 218, 36, "rgba(0,71,64,.4)");
    strokeRoundRect(context, 84, 1132, 912, 218, 36, "rgba(215,239,229,.18)", 1.5);
    drawFittedText(context, "TOTAL TOKENS", 136, 1198, {
      color: "#00A889",
      size: 23,
      weight: 900,
      maxWidth: 360,
    });
    drawFittedText(context, model.totalLabel, 136, 1306, {
      color: "#F7EFD6",
      size: 106,
      minSize: 52,
      weight: 900,
      maxWidth: 650,
    });
    drawFittedText(context, "tokens", 918, 1298, {
      align: "right",
      color: "#D7EFE5",
      size: 34,
      weight: 700,
      maxWidth: 160,
    });

    drawScale(context, model);
    fillRoundRect(context, 84, 1660, 912, 116, 28, "rgba(0,71,64,.46)");
    strokeRoundRect(context, 84, 1660, 912, 116, 28, "rgba(215,239,229,.2)", 1.5);
    fillRoundRect(context, 84, 1660, 6, 116, 3, "#00A889");
    drawFittedText(context, `“我测了一下，原来我已经修到${model.identity.title}了。”`, 124, 1723, {
      baseline: "middle",
      color: "#F7EFD6",
      size: 33,
      minSize: 24,
      weight: 900,
      maxWidth: 832,
    });
    drawFittedText(context, "OpenToken Island 生成 · 本地统计 · 不上传明细", WIDTH / 2, 1836, {
      align: "center",
      color: "#D7EFE5",
      size: 23,
      weight: 600,
      maxWidth: 720,
    });
    return model;
  }

  function canvasToPngBlob(canvas) {
    if (!canvas || typeof canvas.toBlob !== "function") {
      throw new Error("Canvas PNG export is unavailable");
    }
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Failed to render poster PNG"));
      }, PNG_TYPE);
    });
  }

  async function renderCanvasPosterBlob(summary, options = {}) {
    const documentRef = canvasDocument(options);
    if (!documentRef || typeof documentRef.createElement !== "function") {
      throw new Error("Canvas document is unavailable");
    }
    const canvas = documentRef.createElement("canvas");
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    const context = canvas.getContext && canvas.getContext("2d");
    if (!context) throw new Error("Canvas is unavailable");
    drawSharePosterCanvas(context, summary, options);
    return canvasToPngBlob(canvas);
  }

  async function renderSharePosterPngBlob(summary, options = {}) {
    if (typeof options.renderCanvas === "function") {
      return options.renderCanvas(summary, options);
    }
    if (canvasDocument(options)) {
      return renderCanvasPosterBlob(summary, options);
    }
    const templateHtml = options.templateHtml || await loadPosterTemplateHtml(options.templateUrl || TEMPLATE_URL);
    const svg = buildSharePosterSvg(summary, { ...options, templateHtml });
    return options.renderSvg ? options.renderSvg(svg) : svgToPngBlob(svg);
  }

  function downloadBlob(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function isMacPlatform(shareTarget) {
    const target = shareTarget || (root && root.navigator) || {};
    const platform = `${target.platform || ""}`;
    const userAgent = `${target.userAgent || ""}`;
    const touchPoints = Number(target.maxTouchPoints || 0);
    if (/(iPhone|iPad|iPod)/i.test(`${platform} ${userAgent}`)) return false;
    if (/Mac/i.test(platform)) return touchPoints === 0;
    return /Macintosh|Mac OS X/i.test(userAgent) && touchPoints === 0;
  }

  function shouldAvoidFileShare(options, shareTarget) {
    if (typeof options.avoidFileShare === "boolean") return options.avoidFileShare;
    return isMacPlatform(shareTarget);
  }

  function clipboardTarget(options = {}) {
    return options.clipboardTarget || (root && root.navigator && root.navigator.clipboard) || null;
  }

  function clipboardItemConstructor(options = {}) {
    return options.ClipboardItemCtor || (root && root.ClipboardItem) || null;
  }

  async function tryCopyPosterBlob(blob, fileName, options = {}) {
    const clipboard = clipboardTarget(options);
    const ClipboardItemCtor = clipboardItemConstructor(options);
    if (!clipboard || typeof clipboard.write !== "function" || typeof ClipboardItemCtor !== "function") {
      return null;
    }
    try {
      await clipboard.write([new ClipboardItemCtor({ [PNG_TYPE]: blob })]);
      logPosterEvent("poster.copy.complete", { action: "copied", fileName });
      return { action: "copied", fileName };
    } catch (error) {
      logPosterEvent("poster.copy.failed", { name: error && error.name, message: error && error.message });
      return null;
    }
  }

  function canSharePosterFile(shareTarget, file) {
    try {
      return Boolean(shareTarget.canShare({ files: [file] }));
    } catch (error) {
      logPosterEvent("poster.share.unavailable", { name: error && error.name, message: error && error.message });
      return false;
    }
  }

  async function trySharePosterFile(shareTarget, file, fileName) {
    try {
      await shareTarget.share({
        files: [file],
        title: "AI Token Identity",
        text: "我的 AI 修为快照",
      });
      logPosterEvent("poster.download.complete", { action: "shared", fileName });
      return { action: "shared", fileName };
    } catch (error) {
      if (error && error.name === "AbortError") throw error;
      logPosterEvent("poster.share.failed", { name: error && error.name, message: error && error.message, fallback: "download" });
      return null;
    }
  }

  async function downloadSharePoster(summary, options = {}) {
    logPosterEvent("poster.download.start", {
      total: summary?.total || 0,
      rank: fieldValue(summary, options, "rank") || null,
      rankEstimated: Boolean(fieldValue(summary, options, "rankEstimated")),
    });
    try {
      const blob = await renderSharePosterPngBlob(summary, options);
      const fileName = options.fileName || "opentoken-token-identity.png";
      const shareTarget = options.shareTarget || (typeof navigator === "object" ? navigator : null);
      const FileCtor = options.FileCtor || (typeof File === "function" ? File : null);
      const avoidFileShare = shouldAvoidFileShare(options, shareTarget);

      if (avoidFileShare) {
        const copyResult = await tryCopyPosterBlob(blob, fileName, options);
        if (copyResult) return copyResult;
      }

      if (!avoidFileShare && FileCtor && shareTarget?.canShare && shareTarget?.share) {
        const file = new FileCtor([blob], fileName, { type: PNG_TYPE });
        if (canSharePosterFile(shareTarget, file)) {
          const shareResult = await trySharePosterFile(shareTarget, file, fileName);
          if (shareResult) return shareResult;
        }
      }

      const downloader = options.downloader || downloadBlob;
      downloader(blob, fileName);
      logPosterEvent("poster.download.complete", { action: "download-started", fileName });
      return { action: "download-started", fileName };
    } catch (error) {
      logPosterEvent("poster.download.failed", { name: error && error.name, message: error && error.message });
      throw error;
    }
  }

  return {
    buildSharePosterHtml,
    buildSharePosterSvg,
    drawSharePosterCanvas,
    downloadSharePoster,
    getTokenIdentity,
    loadLogoDataUrl,
    loadPosterTemplateHtml,
    renderSharePosterPngBlob,
    svgToPngBlob,
  };
});
