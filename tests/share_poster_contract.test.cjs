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
  assert.match(popoverHtml, /Started/);

  console.log("share poster contract ok");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
