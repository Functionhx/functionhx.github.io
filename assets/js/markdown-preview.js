(function initializeMarkdownPreview() {
  "use strict";

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function safeLink(value) {
    const url = String(value || "").trim();
    return /^(?:https?:\/\/|mailto:|\/[^/]|#)/i.test(url) ? url : "";
  }

  function safeImage(value, resolver) {
    let url = String(value || "").trim();
    if (typeof resolver === "function") url = String(resolver(url) || "").trim();
    if (/^data:image\/(?:gif|jpeg|png|webp);base64,[a-z0-9+/]+=*$/i.test(url)) return url;
    return /^(?:https?:\/\/|\/[^/])/i.test(url) ? url : "";
  }

  function formatInline(value, options) {
    let source = String(value || "");
    const tokens = [];
    const token = (html) => `\u0000MDTOKEN${tokens.push(html) - 1}\u0000`;

    source = source.replace(/`([^`]+)`/g, (_match, code) => token(`<code>${escapeHtml(code)}</code>`));
    source = source.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_match, alt, imageUrl) => {
      const resolved = safeImage(imageUrl, options.resolveImage);
      if (!resolved) return token(`<span class="site-markdown-preview__missing-image">${escapeHtml(alt || options.imageUnavailable)}</span>`);
      return token(`<img src="${escapeHtml(resolved)}" alt="${escapeHtml(alt)}" loading="lazy" decoding="async">`);
    });

    let formatted = escapeHtml(source);
    formatted = formatted.replace(/\[([^\]]+)\]\(((?:https?:\/\/|mailto:|\/|#)[^\s)]+)\)/g, (_match, label, href) => {
      const resolved = safeLink(href.replace(/&amp;/g, "&"));
      return resolved ? `<a href="${escapeHtml(resolved)}">${label}</a>` : label;
    });
    formatted = formatted.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    formatted = formatted.replace(/__([^_]+)__/g, "<strong>$1</strong>");
    formatted = formatted.replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
    formatted = formatted.replace(/(^|[^_])_([^_]+)_/g, "$1<em>$2</em>");
    return formatted.replace(/\u0000MDTOKEN(\d+)\u0000/g, (_match, index) => tokens[Number(index)] || "");
  }

  function tableCells(line) {
    return String(line || "")
      .trim()
      .replace(/^\||\|$/g, "")
      .split("|")
      .map((cell) => cell.trim());
  }

  function render(markdown, inputOptions = {}) {
    const options = {
      imageUnavailable: inputOptions.imageUnavailable || "Image unavailable",
      resolveImage: inputOptions.resolveImage,
    };
    const lines = String(markdown || "")
      .replace(/\r\n/g, "\n")
      .split("\n");
    const output = [];
    let paragraph = [];
    let listType = "";
    let inFence = false;
    let fenceLines = [];

    function closeParagraph() {
      if (!paragraph.length) return;
      output.push(`<p>${paragraph.map((line) => formatInline(line, options)).join("<br>")}</p>`);
      paragraph = [];
    }

    function closeList() {
      if (!listType) return;
      output.push(`</${listType}>`);
      listType = "";
    }

    function closeBlocks() {
      closeParagraph();
      closeList();
    }

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (/^\s*```/.test(line)) {
        closeBlocks();
        if (inFence) {
          output.push(`<pre><code>${escapeHtml(fenceLines.join("\n"))}</code></pre>`);
          fenceLines = [];
          inFence = false;
        } else {
          inFence = true;
        }
        continue;
      }
      if (inFence) {
        fenceLines.push(line);
        continue;
      }
      if (!line.trim()) {
        closeBlocks();
        continue;
      }

      const nextLine = lines[index + 1] || "";
      if (line.includes("|") && /^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$/.test(nextLine)) {
        closeBlocks();
        const headings = tableCells(line);
        const rows = [];
        index += 2;
        while (index < lines.length && lines[index].trim() && lines[index].includes("|")) {
          rows.push(tableCells(lines[index]));
          index += 1;
        }
        index -= 1;
        output.push(
          `<div class="site-markdown-preview__table-wrap"><table><thead><tr>${headings
            .map((cell) => `<th>${formatInline(cell, options)}</th>`)
            .join("")}</tr></thead><tbody>${rows
            .map((row) => `<tr>${headings.map((_heading, cellIndex) => `<td>${formatInline(row[cellIndex] || "", options)}</td>`).join("")}</tr>`)
            .join("")}</tbody></table></div>`
        );
        continue;
      }

      const heading = line.match(/^(#{1,6})\s+(.+)$/);
      if (heading) {
        closeBlocks();
        const level = heading[1].length;
        output.push(`<h${level}>${formatInline(heading[2], options)}</h${level}>`);
        continue;
      }
      if (/^\s*(---+|\*\*\*+)\s*$/.test(line)) {
        closeBlocks();
        output.push("<hr>");
        continue;
      }
      const quote = line.match(/^>\s?(.*)$/);
      if (quote) {
        closeBlocks();
        output.push(`<blockquote><p>${formatInline(quote[1], options)}</p></blockquote>`);
        continue;
      }
      const unordered = line.match(/^\s*[-*+]\s+(.+)$/);
      const ordered = line.match(/^\s*\d+\.\s+(.+)$/);
      if (unordered || ordered) {
        closeParagraph();
        const requestedType = ordered ? "ol" : "ul";
        if (listType && listType !== requestedType) closeList();
        if (!listType) {
          listType = requestedType;
          output.push(`<${listType}>`);
        }
        output.push(`<li>${formatInline((unordered || ordered)[1], options)}</li>`);
        continue;
      }
      closeList();
      paragraph.push(line);
    }

    if (inFence) output.push(`<pre><code>${escapeHtml(fenceLines.join("\n"))}</code></pre>`);
    closeBlocks();
    return output.join("\n");
  }

  window.functionhxMarkdownPreview = Object.freeze({ render });
})();
