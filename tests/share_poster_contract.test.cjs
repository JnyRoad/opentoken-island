const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const poster = require(path.join(root, "assets/share-poster.js"));
const popoverHtml = fs.readFileSync(path.join(root, "popover.html"), "utf8");

const sampleSummary = {
  total: 8_420_000,
  totalLabel: "8,420,000",
};

(async () => {
  assert.equal(typeof poster.buildSharePosterSvg, "function");
  assert.equal(typeof poster.downloadSharePoster, "function");
  assert.equal(typeof poster.getTokenIdentity, "function");

  const identity = poster.getTokenIdentity(sampleSummary.total);
  assert.equal(identity.title, "模型炼金师");
  assert.match(identity.description, /炼成结果/);

  const svg = poster.buildSharePosterSvg(sampleSummary, {
    logoHref: "./assets/scys/icon_topnav.png",
    percentile: 78,
  });

  assert.match(svg, /^<svg[\s\S]+<\/svg>$/);
  assert.match(svg, /生财有术主题版/);
  assert.match(svg, /模型炼金师/);
  assert.match(svg, /8,420,000/);
  assert.match(svg, /超过[\s\S]*78%/);
  assert.doesNotMatch(svg, /航海|航海家/);
  assert.doesNotMatch(svg, /#f2d277|#efe3b6|#fff7d8/i);
  assert.match(svg, /#004740/i);
  assert.match(svg, /#00826F/i);
  assert.match(svg, /#00A889/i);
  assert.match(svg, /#D7EFE5/i);
  assert.match(svg, /#F7EFD6/i);

  [
    [0, 82],
    [100_000, 292],
    [1_000_000, 502],
    [5_000_000, 710],
    [20_000_000, 998],
  ].forEach(([total, expectedX]) => {
    const tierSvg = poster.buildSharePosterSvg({ total }, {
      logoHref: "./assets/scys/icon_topnav.png",
    });
    assert.match(tierSvg, new RegExp(`circle cx="${expectedX}" cy="1132" r="24"`));
    if (expectedX !== 710) {
      assert.doesNotMatch(tierSvg, /circle cx="710" cy="1132" r="24"/);
    }
  });

  const escapedSvg = poster.buildSharePosterSvg({
    total: 1,
    totalLabel: "<script>alert(1)</script>",
  }, {
    logoHref: "\" onload=\"alert(1)",
  });
  assert.doesNotMatch(escapedSvg, /<script>alert\(1\)<\/script>/);
  assert.match(escapedSvg, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(escapedSvg, /" onload="alert\(1\)/);

  let downloaded = null;
  const result = await poster.downloadSharePoster(sampleSummary, {
    logoHref: "./assets/scys/icon_topnav.png",
    renderSvg: async (inputSvg) => {
      assert.match(inputSvg, /模型炼金师/);
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
  assert.match(popoverHtml, /posterErrorLabel/);
  assert.match(popoverHtml, /Started/);

  console.log("share poster contract ok");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
