(function attachSharePoster(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.OpenTokenSharePoster = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function createSharePosterApi() {
  const WIDTH = 1080;
  const HEIGHT = 1440;
  const LOGO_URL = "./assets/scys/icon_topnav.png";
  const PNG_TYPE = "image/png";
  const SVG_TYPE = "image/svg+xml;charset=utf-8";

  const TOKEN_IDENTITIES = [
    {
      min: 0,
      title: "刚上手",
      shortTitle: "刚上手",
      description: "刚开始把问题交给 AI。",
    },
    {
      min: 100_000,
      title: "会拆题",
      shortTitle: "会拆题",
      description: "能把大问题拆成可执行步骤。",
    },
    {
      min: 1_000_000,
      title: "能出活",
      shortTitle: "能出活",
      description: "能用 AI 产出方案、代码和文档。",
    },
    {
      min: 5_000_000,
      title: "模型炼金师",
      shortTitle: "炼金师",
      description: "把模糊问题反复烧到能炼成结果。",
    },
    {
      min: 20_000_000,
      title: "算力合伙人",
      shortTitle: "算力合伙人",
      description: "把 token 投向更快验证和真实交付。",
    },
  ];
  const TIER_MARKER_X = [82, 292, 502, 710, 998];

  function escapeXml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#39;",
    }[char]));
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function formatCount(value) {
    const number = Number(value || 0);
    return Number.isFinite(number) ? Math.round(number).toLocaleString("en-US") : "0";
  }

  function getTokenIdentity(totalTokens) {
    const total = Math.max(0, Number(totalTokens || 0));
    let index = 0;
    for (let i = 0; i < TOKEN_IDENTITIES.length; i += 1) {
      if (total >= TOKEN_IDENTITIES[i].min) index = i;
    }
    const identity = TOKEN_IDENTITIES[index];
    const next = TOKEN_IDENTITIES[index + 1] || null;
    const markerProgress = index / (TOKEN_IDENTITIES.length - 1);
    const rangeProgress = next
      ? clamp((total - identity.min) / (next.min - identity.min), 0, 1)
      : 1;
    return {
      ...identity,
      index,
      next,
      markerProgress,
      rangeProgress,
    };
  }

  function buildTierScale(activeIndex, markerX) {
    const circles = TOKEN_IDENTITIES.map((tier, index) => {
      const x = TIER_MARKER_X[index];
      const active = index === activeIndex;
      const opacity = !active && index === TOKEN_IDENTITIES.length - 1 ? ' fill-opacity="0.38"' : "";
      return `<circle cx="${x}" cy="1132" r="${active ? 24 : 14}"${opacity}/>`;
    }).join("");

    const labels = TOKEN_IDENTITIES.map((tier, index) => {
      const x = TIER_MARKER_X[index];
      const active = index === activeIndex;
      return `<text x="${x}" y="${active ? 1184 : 1182}" text-anchor="middle" font-size="${active ? 23 : 18}" font-weight="${active ? 950 : 850}" fill="${active ? "#F7EFD6" : "#D7EFE5"}"${active ? "" : ' fill-opacity="0.78"'}>${escapeXml(tier.shortTitle)}</text>`;
    }).join("\n    ");

    return `<g fill="#D7EFE5">${circles}</g>
    <circle cx="${markerX}" cy="1132" r="36" fill="none" stroke="#F7EFD6" stroke-width="4"/>
    ${labels}`;
  }

  function buildSharePosterSvg(summary, options = {}) {
    const total = Number(summary?.total || 0);
    const totalLabel = summary?.totalLabel && summary.totalLabel !== "--"
      ? summary.totalLabel
      : formatCount(total);
    const identity = getTokenIdentity(total);
    const logoHref = options.logoHref || LOGO_URL;
    const percentile = Number(options.percentile || 0);
    const hasPercentile = Number.isFinite(percentile) && percentile > 0;
    const percentLabel = hasPercentile ? `${clamp(Math.round(percentile), 1, 99)}%` : `${Math.round(identity.rangeProgress * 100)}%`;
    const percentTop = hasPercentile ? "超过" : "进度";
    const percentBottom = hasPercentile ? "用户" : "本档";
    const progressWidth = Math.round(610 * clamp(identity.markerProgress + identity.rangeProgress * 0.16, 0.05, 1));
    const markerX = TIER_MARKER_X[identity.index] || TIER_MARKER_X[0];
    const tierScaleSvg = buildTierScale(identity.index, markerX);
    const quote = `“我测了一下，原来我是${identity.title}。”`;

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#004740"/>
      <stop offset="0.48" stop-color="#00826F"/>
      <stop offset="1" stop-color="#005B50"/>
    </linearGradient>
    <radialGradient id="glow" cx="76%" cy="18%" r="58%">
      <stop offset="0" stop-color="#00A889" stop-opacity="0.42"/>
      <stop offset="1" stop-color="#00A889" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="lowGlow" cx="20%" cy="86%" r="50%">
      <stop offset="0" stop-color="#D7EFE5" stop-opacity="0.18"/>
      <stop offset="1" stop-color="#D7EFE5" stop-opacity="0"/>
    </radialGradient>
    <pattern id="lineGrid" width="64" height="64" patternUnits="userSpaceOnUse">
      <path d="M64 0H0V64" fill="none" stroke="#D7EFE5" stroke-opacity="0.055" stroke-width="1"/>
    </pattern>
    <filter id="shadow" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="24" stdDeviation="26" flood-color="#00322D" flood-opacity="0.36"/>
    </filter>
    <clipPath id="logoClip"><rect x="72" y="72" width="190" height="124" rx="26"/></clipPath>
  </defs>

  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bg)"/>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#glow)"/>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#lowGlow)"/>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#lineGrid)"/>
  <circle cx="926" cy="168" r="274" fill="none" stroke="#D7EFE5" stroke-opacity="0.16" stroke-width="2"/>
  <circle cx="926" cy="168" r="186" fill="none" stroke="#D7EFE5" stroke-opacity="0.11" stroke-width="2"/>
  <circle cx="172" cy="1230" r="310" fill="none" stroke="#D7EFE5" stroke-opacity="0.10" stroke-width="2"/>
  <g font-family="PingFang SC, Hiragino Sans GB, Microsoft YaHei, Noto Sans CJK SC, sans-serif" opacity="0.085">
    <text x="116" y="322" font-size="108" font-weight="950" fill="#D7EFE5">真诚</text>
    <text x="664" y="350" font-size="102" font-weight="950" fill="#D7EFE5">开放</text>
    <text x="-10" y="1040" font-size="120" font-weight="950" fill="#D7EFE5">利他</text>
    <text x="666" y="1120" font-size="116" font-weight="950" fill="#D7EFE5">空杯</text>
  </g>

  <image href="${escapeXml(logoHref)}" x="72" y="72" width="190" height="124" clip-path="url(#logoClip)" preserveAspectRatio="xMidYMid meet"/>
  <rect x="72" y="72" width="190" height="124" rx="26" fill="none" stroke="#D7EFE5" stroke-opacity="0.34" stroke-width="2"/>

  <g font-family="PingFang SC, Hiragino Sans GB, Microsoft YaHei, Noto Sans CJK SC, sans-serif">
    <text x="292" y="114" font-size="24" font-weight="900" fill="#F7EFD6" letter-spacing="4">AI TOKEN IDENTITY</text>
    <text x="292" y="152" font-size="18" font-weight="700" fill="#D7EFE5" fill-opacity="0.86" letter-spacing="2">个人消耗画像 · 生财有术主题版</text>
    <rect x="798" y="88" width="158" height="54" rx="27" fill="#004740" fill-opacity="0.72" stroke="#D7EFE5" stroke-opacity="0.36"/>
    <text x="877" y="123" text-anchor="middle" font-size="20" font-weight="900" fill="#F7EFD6">2026 版</text>
  </g>

  <g font-family="PingFang SC, Hiragino Sans GB, Microsoft YaHei, Noto Sans CJK SC, sans-serif">
    <rect x="72" y="270" width="406" height="58" rx="29" fill="#004740" fill-opacity="0.42" stroke="#D7EFE5" stroke-opacity="0.18"/>
    <circle cx="106" cy="299" r="7" fill="#D7EFE5"/>
    <text x="128" y="307" font-size="24" font-weight="900" fill="#F7EFD6">没想到，我把 AI 用成了</text>
    <text x="72" y="496" font-size="124" font-weight="950" fill="#F7EFD6" letter-spacing="0">${escapeXml(identity.title)}</text>
    <text x="76" y="560" font-size="34" font-weight="900" fill="#D7EFE5">不是在消耗，是把想法炼成结果。</text>
    <text x="76" y="610" font-size="26" font-weight="650" fill="#D7EFE5" fill-opacity="0.82">方案、代码、文档、原型，每一次调用都应该更接近交付。</text>
  </g>

  <g filter="url(#shadow)" font-family="PingFang SC, Hiragino Sans GB, Microsoft YaHei, Noto Sans CJK SC, sans-serif">
    <rect x="72" y="716" width="936" height="268" rx="34" fill="#003F39" fill-opacity="0.82" stroke="#D7EFE5" stroke-opacity="0.22"/>
    <text x="116" y="784" font-size="21" font-weight="900" fill="#D7EFE5" letter-spacing="8">TOTAL TOKENS</text>
    <text x="116" y="896" font-size="104" font-weight="950" fill="#F7EFD6">${escapeXml(totalLabel)}</text>
    <text x="666" y="890" font-size="28" font-weight="900" fill="#D7EFE5">tokens</text>
    <rect x="116" y="928" width="610" height="18" rx="9" fill="#D7EFE5" fill-opacity="0.18"/>
    <rect x="116" y="928" width="${progressWidth}" height="18" rx="9" fill="#00A889"/>
    <rect x="116" y="928" width="${Math.max(90, Math.round(progressWidth * 0.66))}" height="18" rx="9" fill="#D7EFE5" fill-opacity="0.92"/>
    <text x="116" y="966" font-size="19" font-weight="800" fill="#D7EFE5" fill-opacity="0.82">${hasPercentile ? `高于 ${percentLabel} 用户` : `称号进度 ${percentLabel}`} · 可隐藏具体数字</text>
    <circle cx="848" cy="850" r="82" fill="#00826F" stroke="#D7EFE5" stroke-opacity="0.42" stroke-width="2"/>
    <text x="848" y="824" text-anchor="middle" font-size="21" font-weight="900" fill="#D7EFE5">${percentTop}</text>
    <text x="848" y="878" text-anchor="middle" font-size="54" font-weight="950" fill="#F7EFD6">${percentLabel}</text>
    <text x="848" y="910" text-anchor="middle" font-size="18" font-weight="900" fill="#D7EFE5">${percentBottom}</text>
  </g>

  <g font-family="PingFang SC, Hiragino Sans GB, Microsoft YaHei, Noto Sans CJK SC, sans-serif">
    <text x="72" y="1076" font-size="22" font-weight="950" fill="#F7EFD6" letter-spacing="4">称号刻度</text>
    <line x1="82" y1="1132" x2="998" y2="1132" stroke="#D7EFE5" stroke-opacity="0.24" stroke-width="10" stroke-linecap="round"/>
    <line x1="82" y1="1132" x2="${markerX}" y2="1132" stroke="#00A889" stroke-width="10" stroke-linecap="round"/>
    ${tierScaleSvg}
  </g>

  <g font-family="PingFang SC, Hiragino Sans GB, Microsoft YaHei, Noto Sans CJK SC, sans-serif">
    <rect x="72" y="1256" width="704" height="86" rx="28" fill="#004740" fill-opacity="0.58" stroke="#D7EFE5" stroke-opacity="0.24"/>
    <text x="108" y="1310" font-size="27" font-weight="950" fill="#F7EFD6">${escapeXml(quote)}</text>
    <rect x="830" y="1242" width="132" height="132" rx="28" fill="#004740" stroke="#D7EFE5" stroke-opacity="0.30"/>
    <g fill="#F7EFD6"><rect x="850" y="1262" width="20" height="20"/><rect x="878" y="1262" width="20" height="20"/><rect x="924" y="1262" width="20" height="20"/><rect x="850" y="1290" width="20" height="20"/><rect x="896" y="1290" width="20" height="20"/><rect x="924" y="1290" width="20" height="20"/><rect x="878" y="1318" width="20" height="20"/><rect x="896" y="1318" width="20" height="20"/><rect x="850" y="1346" width="20" height="20"/><rect x="924" y="1346" width="20" height="20"/></g>
    <text x="72" y="1412" font-size="18" font-weight="700" fill="#D7EFE5" fill-opacity="0.70">OpenToken Island 生成 · 本地统计 · 不上传明细</text>
  </g>
</svg>`;
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("Failed to read logo asset"));
      reader.readAsDataURL(blob);
    });
  }

  async function loadLogoDataUrl(logoUrl = LOGO_URL) {
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
    const logoHref = options.logoHref || await loadLogoDataUrl(options.logoUrl || LOGO_URL);
    const svg = buildSharePosterSvg(summary, { ...options, logoHref });
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
          text: "我的 AI Token 消耗身份",
        });
        return { action: "shared", fileName };
      }
    }

    const downloader = options.downloader || downloadBlob;
    downloader(blob, fileName);
    return { action: "download-started", fileName };
  }

  return {
    buildSharePosterSvg,
    downloadSharePoster,
    getTokenIdentity,
    loadLogoDataUrl,
    svgToPngBlob,
  };
});
