const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const poster = require(path.join(root, "assets/share-poster.js"));
const popoverHtml = fs.readFileSync(path.join(root, "popover.html"), "utf8");
const templateHtml = fs.readFileSync(path.join(root, "assets/share-poster-template.html"), "utf8");

const sampleSummary = {
  total: 4_500_000_000,
  totalLabel: "45亿",
  rank: 1,
  rankLabel: "#1",
  rankDelta: 12,
  rankEstimated: false,
  gapToPreviousLabel: "0",
  leadOverNextLabel: "8.6亿",
};

function createRecordingCanvasDocument() {
  const calls = [];
  const context = {
    calls,
    fillStyle: "",
    strokeStyle: "",
    font: "",
    textAlign: "left",
    textBaseline: "alphabetic",
    lineWidth: 1,
    globalAlpha: 1,
    save() { calls.push(["save"]); },
    restore() { calls.push(["restore"]); },
    beginPath() { calls.push(["beginPath"]); },
    closePath() { calls.push(["closePath"]); },
    moveTo(x, y) { calls.push(["moveTo", x, y]); },
    lineTo(x, y) { calls.push(["lineTo", x, y]); },
    quadraticCurveTo(cpx, cpy, x, y) { calls.push(["quadraticCurveTo", cpx, cpy, x, y]); },
    arc(x, y, radius, startAngle, endAngle) { calls.push(["arc", x, y, radius, startAngle, endAngle]); },
    clearRect(x, y, width, height) { calls.push(["clearRect", x, y, width, height]); },
    fillRect(x, y, width, height) { calls.push(["fillRect", x, y, width, height, this.fillStyle]); },
    fill() { calls.push(["fill", this.fillStyle]); },
    stroke() { calls.push(["stroke", this.strokeStyle, this.lineWidth]); },
    fillText(text, x, y) { calls.push(["fillText", String(text), x, y, this.font]); },
    measureText(text) { return { width: String(text).length * 42 }; },
    createLinearGradient() {
      const stops = [];
      calls.push(["createLinearGradient", stops]);
      return {
        addColorStop(offset, color) {
          stops.push([offset, color]);
        },
      };
    },
    createRadialGradient() {
      const stops = [];
      calls.push(["createRadialGradient", stops]);
      return {
        addColorStop(offset, color) {
          stops.push([offset, color]);
        },
      };
    },
  };
  const canvas = {
    width: 0,
    height: 0,
    getContext(type) {
      calls.push(["getContext", type]);
      return context;
    },
    toBlob(callback, type) {
      calls.push(["toBlob", type]);
      callback({ type, size: 1234, calls });
    },
  };
  const document = {
    createElement(tagName) {
      calls.push(["createElement", tagName]);
      assert.equal(tagName, "canvas");
      return canvas;
    },
  };
  return { document, canvas, calls };
}

(async () => {
  assert.equal(typeof poster.buildSharePosterSvg, "function");
  assert.equal(typeof poster.buildSharePosterHtml, "function");
  assert.equal(typeof poster.downloadSharePoster, "function");
  assert.equal(typeof poster.getTokenIdentity, "function");

  [
    [0, "炼气期"],
    [10_000_000, "筑基期"],
    [100_000_000, "金丹期"],
    [500_000_000, "元婴期"],
    [1_500_000_000, "化神期"],
    [4_000_000_000, "大乘期"],
    [10_000_000_000, "渡劫期"],
  ].forEach(([total, title]) => {
    assert.equal(poster.getTokenIdentity(total).title, title);
  });
  assert.equal(poster.getTokenIdentity(sampleSummary.total).title, "大乘期");
  assert.equal(poster.getTokenIdentity(9_999_999_999).title, "大乘期");
  assert.equal(poster.getTokenIdentity("bad").title, "炼气期");
  assert.equal(Number.isFinite(poster.getTokenIdentity("bad").total), true);
  assert.equal(Number.isFinite(poster.getTokenIdentity("bad").rangeProgress), true);

  assert.match(templateHtml, /SHARE_POSTER_FRAGMENT_START/);
  assert.match(templateHtml, /{{REALM_TITLE}}/);
  assert.match(templateHtml, /{{SCALE_PROGRESS}}/);

  const generatedHtml = poster.buildSharePosterHtml(sampleSummary, {
    templateHtml,
  });

  assert.match(generatedHtml, /^<!doctype html>/);
  assert.match(generatedHtml, /个人 AI 消耗画像 · 修为快照/);
  assert.match(generatedHtml, /我的 AI 修为，已修到/);
  assert.match(generatedHtml, /<h1 class="title">大乘期<span class="accent"><\/span><\/h1>/);
  assert.match(generatedHtml, /#1/);
  assert.match(generatedHtml, /45亿/);
  assert.match(generatedHtml, /8\.6亿/);
  assert.match(generatedHtml, /榜首<small><\/small>/);
  assert.doesNotMatch(generatedHtml, /榜首<small>tokens<\/small>/);
  assert.match(generatedHtml, /渡劫期/);
  assert.match(generatedHtml, /node cur/);
  assert.match(generatedHtml, /tick cur">大乘期/);
  assert.doesNotMatch(generatedHtml, /{{[A-Z0-9_]+}}/);
  assert.doesNotMatch(generatedHtml, /超过[\s\S]*78%/);
  assert.doesNotMatch(generatedHtml, /航海|航海家/);

  const svg = poster.buildSharePosterSvg(sampleSummary, {
    templateHtml,
  });

  assert.match(svg, /^<svg[\s\S]+<\/svg>$/);
  assert.match(svg, /width="1080" height="1920"/);
  assert.match(svg, /<foreignObject width="1080" height="1920">/);
  assert.match(svg, /xmlns="http:\/\/www\.w3\.org\/1999\/xhtml"/);
  assert.match(svg, /大乘期/);
  assert.match(svg, /#1/);
  assert.match(svg, /45亿/);
  assert.match(svg, /8\.6亿/);
  assert.match(svg, /渡劫期/);
  assert.match(svg, /OpenToken Island 生成 · 本地统计 · 不上传明细/);
  assert.doesNotMatch(svg, /超过[\s\S]*78%/);
  assert.doesNotMatch(svg, /航海|航海家/);
  assert.doesNotMatch(svg, /#f2d277|#efe3b6|#fff7d8/i);
  assert.match(svg, /#004740/i);
  assert.match(svg, /#00826F/i);
  assert.match(svg, /#00A889/i);
  assert.match(svg, /#D7EFE5/i);
  assert.match(svg, /#F7EFD6/i);

  [
    [0, "炼气期"],
    [10_000_000, "筑基期"],
    [100_000_000, "金丹期"],
    [500_000_000, "元婴期"],
    [1_500_000_000, "化神期"],
    [4_000_000_000, "大乘期"],
    [10_000_000_000, "渡劫期"],
  ].forEach(([total, title]) => {
    const tierHtml = poster.buildSharePosterHtml({ total }, {
      templateHtml,
    });
    assert.match(tierHtml, new RegExp(`tick cur">${title}`));
  });

  const escapedHtml = poster.buildSharePosterHtml({
    total: 1,
    totalLabel: "<script>alert(1)</script>",
    rank: 2,
    rankLabel: "<b>#2</b>",
    gapToPreviousLabel: "\" onmouseover=\"alert(1)",
  }, {
    templateHtml,
  });
  assert.doesNotMatch(escapedHtml, /<script>alert\(1\)<\/script>/);
  assert.match(escapedHtml, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(escapedHtml, /&lt;b&gt;#2&lt;\/b&gt;/);
  assert.doesNotMatch(escapedHtml, /" onmouseover="alert\(1\)/);

  const invalidDeltaHtml = poster.buildSharePosterHtml({
    total: sampleSummary.total,
    rank: 2,
    rankLabel: "#2",
    rankDelta: "bad",
  }, {
    templateHtml,
  });
  assert.doesNotMatch(invalidDeltaHtml, /<span class="delta /);

  const downDeltaHtml = poster.buildSharePosterHtml({
    total: sampleSummary.total,
    rank: 2,
    rankLabel: "#2",
    rankDelta: -3,
  }, {
    templateHtml,
  });
  assert.match(downDeltaHtml, /<span class="delta down">/);
  assert.doesNotMatch(downDeltaHtml, /<span class="delta up">/);

  const invalidTotalHtml = poster.buildSharePosterHtml({
    total: "bad",
  }, {
    templateHtml,
  });
  assert.doesNotMatch(invalidTotalHtml, /NaN/);
  assert.match(invalidTotalHtml, /炼气期/);

  assert.equal(typeof poster.renderSharePosterPngBlob, "function");
  const nativeCanvas = createRecordingCanvasDocument();
  let nativeDownloaded = null;
  const nativeResult = await poster.downloadSharePoster(sampleSummary, {
    templateHtml,
    document: nativeCanvas.document,
    renderSvg: async () => {
      const error = new Error("foreignObject path should not run when canvas is available");
      error.name = "SecurityError";
      throw error;
    },
    downloader: (blob, fileName) => {
      nativeDownloaded = { blob, fileName };
    },
  });
  assert.equal(nativeResult.action, "download-started");
  assert.equal(nativeCanvas.canvas.width, 1080);
  assert.equal(nativeCanvas.canvas.height, 1920);
  assert.deepEqual(
    nativeCanvas.calls.filter((call) => call[0] === "toBlob").map((call) => call[1]),
    ["image/png"]
  );
  assert.equal(nativeDownloaded.blob.type, "image/png");
  const drawnText = nativeCanvas.calls
    .filter((call) => call[0] === "fillText")
    .map((call) => call[1]);
  assert.ok(drawnText.includes("大乘期"));
  assert.ok(drawnText.includes("#1"));
  assert.ok(drawnText.includes("45亿"));
  assert.ok(drawnText.includes("8.6亿"));
  assert.equal(nativeDownloaded.fileName, "opentoken-token-identity.png");

  let macShareCalled = false;
  let macDownloaded = null;
  const clipboardWrites = [];
  const macCopyResult = await poster.downloadSharePoster(sampleSummary, {
    renderCanvas: async () => ({ type: "image/png" }),
    ClipboardItemCtor: function TestClipboardItem(items) {
      this.items = items;
    },
    clipboardTarget: {
      async write(items) {
        clipboardWrites.push(items);
      },
    },
    FileCtor: function TestFile(parts, fileName, options) {
      this.parts = parts;
      this.name = fileName;
      this.type = options.type;
    },
    shareTarget: {
      platform: "MacIntel",
      canShare() {
        return true;
      },
      async share() {
        macShareCalled = true;
      },
    },
    downloader: (blob, fileName) => {
      macDownloaded = { blob, fileName };
    },
  });
  assert.equal(macCopyResult.action, "copied");
  assert.equal(macCopyResult.fileName, "opentoken-token-identity.png");
  assert.equal(macShareCalled, false);
  assert.equal(macDownloaded, null);
  assert.equal(clipboardWrites.length, 1);
  assert.equal(clipboardWrites[0].length, 1);
  assert.equal(clipboardWrites[0][0].items["image/png"].type, "image/png");

  let macNoClipboardShareCalled = false;
  let macNoClipboardDownloaded = null;
  const macNoClipboardResult = await poster.downloadSharePoster(sampleSummary, {
    renderCanvas: async () => ({ type: "image/png" }),
    FileCtor: function TestFile(parts, fileName, options) {
      this.parts = parts;
      this.name = fileName;
      this.type = options.type;
    },
    shareTarget: {
      platform: "MacIntel",
      canShare() {
        return true;
      },
      async share() {
        macNoClipboardShareCalled = true;
      },
    },
    downloader: (blob, fileName) => {
      macNoClipboardDownloaded = { blob, fileName };
    },
  });
  assert.equal(macNoClipboardResult.action, "download-started");
  assert.equal(macNoClipboardShareCalled, false);
  assert.equal(macNoClipboardDownloaded.blob.type, "image/png");
  assert.equal(macNoClipboardDownloaded.fileName, "opentoken-token-identity.png");

  let iphoneShareCalled = false;
  let iphoneDownloaded = null;
  const iphoneShareResult = await poster.downloadSharePoster(sampleSummary, {
    renderCanvas: async () => ({ type: "image/png" }),
    FileCtor: function TestFile(parts, fileName, options) {
      this.parts = parts;
      this.name = fileName;
      this.type = options.type;
    },
    shareTarget: {
      platform: "iPhone",
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1",
      maxTouchPoints: 5,
      canShare() {
        return true;
      },
      async share() {
        iphoneShareCalled = true;
      },
    },
    downloader: (blob, fileName) => {
      iphoneDownloaded = { blob, fileName };
    },
  });
  assert.equal(iphoneShareResult.action, "shared");
  assert.equal(iphoneShareCalled, true);
  assert.equal(iphoneDownloaded, null);

  let fallbackDownloaded = null;
  const fallbackResult = await poster.downloadSharePoster(sampleSummary, {
    renderCanvas: async () => ({ type: "image/png" }),
    FileCtor: function TestFile(parts, fileName, options) {
      this.parts = parts;
      this.name = fileName;
      this.type = options.type;
    },
    shareTarget: {
      canShare() {
        return true;
      },
      async share() {
        const error = new Error("The operation is insecure.");
        error.name = "SecurityError";
        throw error;
      },
    },
    downloader: (blob, fileName) => {
      fallbackDownloaded = { blob, fileName };
    },
  });
  assert.equal(fallbackResult.action, "download-started");
  assert.equal(fallbackDownloaded.blob.type, "image/png");
  assert.equal(fallbackDownloaded.fileName, "opentoken-token-identity.png");

  let downloaded = null;
  const result = await poster.downloadSharePoster(sampleSummary, {
    templateHtml,
    renderSvg: async (inputSvg) => {
      assert.match(inputSvg, /foreignObject/);
      assert.match(inputSvg, /大乘期/);
      return { type: "image/png" };
    },
    downloader: (blob, fileName) => {
      downloaded = { blob, fileName };
    },
  });
  assert.equal(result.action, "download-started");
  assert.equal(result.fileName, "opentoken-token-identity.png");
  assert.equal(downloaded.fileName, "opentoken-token-identity.png");

  assert.match(popoverHtml, /<script src="\.\/assets\/share-poster\.js"><\/script>/);
  assert.match(popoverHtml, /id="shareButton"/);
  assert.match(popoverHtml, /sharePoster/);
  assert.match(popoverHtml, /const posterOptions = \{[\s\S]*rankLabel: summary\.rankLabel[\s\S]*rankDelta: summary\.rankDelta[\s\S]*gapToPreviousLabel: summary\.gapToPreviousLabel[\s\S]*leadOverNextLabel: summary\.leadOverNextLabel[\s\S]*templateUrl: '\.\/assets\/share-poster-template\.html'[\s\S]*\};/);
  assert.match(popoverHtml, /downloadSharePoster\(summary, posterOptions\)/);
  assert.match(popoverHtml, /posterErrorLabel/);
  assert.match(popoverHtml, /Copied/);
  assert.match(popoverHtml, /Started/);

  console.log("share poster contract ok");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
