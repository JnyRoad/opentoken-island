(function attachSharePoster(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.OpenTokenSharePoster = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function createSharePosterApi() {
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

  function templateValueMap(summary = {}, options = {}) {
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
    const replacements = {
      REALM_TITLE: escapeHtml(identity.title),
      REALM_DESCRIPTION: escapeHtml(identity.description),
      RANK_LABEL: escapeHtml(rankLabel),
      RANK_DELTA_BADGE: buildRankDeltaBadge(fieldValue(summary, options, "rankDelta"), rankEstimated),
      GAP_TO_PREVIOUS: escapeHtml(gapToPrevious),
      GAP_TO_PREVIOUS_UNIT: escapeHtml(tokenUnitFor(gapToPrevious)),
      LEAD_OVER_NEXT: escapeHtml(leadOverNext),
      LEAD_OVER_NEXT_UNIT: escapeHtml(tokenUnitFor(leadOverNext)),
      TOTAL_LABEL: escapeHtml(summary?.totalLabel && summary.totalLabel !== "--" ? summary.totalLabel : formatCount(total)),
      SCALE_PROGRESS: scaleProgress(identity),
    };

    TOKEN_IDENTITIES.forEach((tier, index) => {
      replacements[`NODE_${index}_CLASS`] = index < identity.index
        ? "done"
        : index === identity.index
          ? "cur"
          : "future";
      replacements[`TICK_${index}_CLASS`] = index === identity.index ? "cur" : "";
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

  async function downloadSharePoster(summary, options = {}) {
    const templateHtml = options.templateHtml || await loadPosterTemplateHtml(options.templateUrl || TEMPLATE_URL);
    const svg = buildSharePosterSvg(summary, { ...options, templateHtml });
    const blob = options.renderSvg ? await options.renderSvg(svg) : await svgToPngBlob(svg);
    const fileName = options.fileName || "opentoken-token-identity.png";
    const shareTarget = options.shareTarget || (typeof navigator === "object" ? navigator : null);
    const FileCtor = options.FileCtor || (typeof File === "function" ? File : null);

    if (FileCtor && shareTarget?.canShare && shareTarget?.share) {
      const file = new FileCtor([blob], fileName, { type: PNG_TYPE });
      if (shareTarget.canShare({ files: [file] })) {
        await shareTarget.share({
          files: [file],
          title: "AI Token Identity",
          text: "我的 AI 修为快照",
        });
        return { action: "shared", fileName };
      }
    }

    const downloader = options.downloader || downloadBlob;
    downloader(blob, fileName);
    return { action: "download-started", fileName };
  }

  return {
    buildSharePosterHtml,
    buildSharePosterSvg,
    downloadSharePoster,
    getTokenIdentity,
    loadLogoDataUrl,
    loadPosterTemplateHtml,
    svgToPngBlob,
  };
});
