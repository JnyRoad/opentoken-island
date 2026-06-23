(function () {
  const NS = "http://www.w3.org/2000/svg";
  const icons = {
    award: [
      '<circle cx="12" cy="8" r="6"></circle>',
      '<path d="M15.5 13.5 17 22l-5-3-5 3 1.5-8.5"></path>',
    ],
    bot: [
      '<rect x="5" y="8" width="14" height="10" rx="2"></rect>',
      '<path d="M12 8V4"></path>',
      '<path d="M8 12h.01"></path>',
      '<path d="M16 12h.01"></path>',
      '<path d="M9 16h6"></path>',
    ],
    "code-2": [
      '<path d="m18 16 4-4-4-4"></path>',
      '<path d="m6 8-4 4 4 4"></path>',
      '<path d="m14.5 4-5 16"></path>',
    ],
    crown: [
      '<path d="m2 6 5 5 5-8 5 8 5-5-2 13H4L2 6z"></path>',
      '<path d="M4 19h16"></path>',
    ],
    "file-text": [
      '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>',
      '<path d="M14 2v6h6"></path>',
      '<path d="M8 13h8"></path>',
      '<path d="M8 17h8"></path>',
      '<path d="M8 9h2"></path>',
    ],
    flame: [
      '<path d="M8.5 14.5A4.5 4.5 0 0 0 13 19a5 5 0 0 0 5-5c0-4-3-5-4-9-2 2-4 4-4 7 0 1 .5 2 1 2.5"></path>',
      '<path d="M12 22a8 8 0 0 1-8-8c0-3 1.6-5.4 4.2-7.5-.2 2.5.8 4.4 2.3 5.5"></path>',
    ],
    lock: [
      '<rect x="4" y="11" width="16" height="10" rx="2"></rect>',
      '<path d="M8 11V7a4 4 0 0 1 8 0v4"></path>',
    ],
    moon: ['<path d="M21 12.8A8.5 8.5 0 1 1 11.2 3 6.5 6.5 0 0 0 21 12.8z"></path>'],
    "panel-top-open": [
      '<rect x="3" y="3" width="18" height="18" rx="2"></rect>',
      '<path d="M3 9h18"></path>',
      '<path d="m9 15 3-3 3 3"></path>',
    ],
    pause: [
      '<path d="M8 5v14"></path>',
      '<path d="M16 5v14"></path>',
    ],
    "refresh-cw": [
      '<path d="M21 12a9 9 0 0 1-15.3 6.4"></path>',
      '<path d="M3 12A9 9 0 0 1 18.3 5.6"></path>',
      '<path d="M18 2v4h4"></path>',
      '<path d="M6 22v-4H2"></path>',
    ],
    "share-2": [
      '<circle cx="18" cy="5" r="3"></circle>',
      '<circle cx="6" cy="12" r="3"></circle>',
      '<circle cx="18" cy="19" r="3"></circle>',
      '<path d="m8.6 13.5 6.8 4"></path>',
      '<path d="m15.4 6.5-6.8 4"></path>',
    ],
    sparkles: [
      '<path d="m12 3 1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8L12 3z"></path>',
      '<path d="m5 14 .8 1.8L8 17l-2.2.8L5 20l-.8-2.2L2 17l2.2-1.2L5 14z"></path>',
      '<path d="m19 14 .8 1.8L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-1.2L19 14z"></path>',
    ],
    target: [
      '<circle cx="12" cy="12" r="10"></circle>',
      '<circle cx="12" cy="12" r="6"></circle>',
      '<circle cx="12" cy="12" r="2"></circle>',
    ],
    terminal: [
      '<path d="m4 17 6-6-6-6"></path>',
      '<path d="M12 19h8"></path>',
    ],
    "timer-reset": [
      '<path d="M10 2h4"></path>',
      '<path d="M12 14v-4"></path>',
      '<path d="M12 22a8 8 0 1 0-7.6-10.5"></path>',
      '<path d="M4 8v4h4"></path>',
    ],
    "trending-up": [
      '<path d="m3 17 6-6 4 4 7-7"></path>',
      '<path d="M14 8h6v6"></path>',
    ],
    "upload-cloud": [
      '<path d="M16 16 12 12 8 16"></path>',
      '<path d="M12 12v9"></path>',
      '<path d="M20 16.6A5 5 0 0 0 18 7h-1.3A8 8 0 1 0 4 15.3"></path>',
    ],
    zap: ['<path d="M13 2 3 14h8l-1 8 11-14h-8l1-6z"></path>'],
  };

  function createSvg(name, markup) {
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("class", `lucide lucide-${name}`);
    svg.setAttribute("aria-hidden", "true");
    svg.innerHTML = markup.join("");
    return svg;
  }

  window.lucide = {
    createIcons() {
      document.querySelectorAll("i[data-lucide]").forEach((node) => {
        const name = node.getAttribute("data-lucide") || "terminal";
        node.replaceWith(createSvg(name, icons[name] || icons.terminal));
      });
    },
  };
}());
