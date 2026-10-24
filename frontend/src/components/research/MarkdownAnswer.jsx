// Minimal, safe Markdown renderer for AI answers and synthesis sections.
// Builds React elements (never innerHTML), so model output cannot inject markup.
// Supports: #/##/### headings, paragraphs, - * • bullets, 1. lists, ``` code,
// > quotes, | tables |, **bold**, *italic* / _italic_, `code`, [text](https://…) links and
// citation markers [1], [1][2], [1, 2] which become buttons that open the source.

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\[(?:\d+\s*(?:,\s*\d+\s*)*)\](?:\[\d+\])*|\[[^\]]+\]\(https?:\/\/[^)\s]+\)|(?<![\w*])\*[^*\s][^*]*\*(?![\w*])|(?<![\w])_[^_\s][^_]*_(?![\w]))/g;

function CiteRef({ number, citation, onCite }) {
  const label = citation
    ? `${citation.documentTitle || "Source"}${citation.pageNumber ? `, p. ${citation.pageNumber}` : ""}`
    : `Source ${number}`;
  return (
    <button
      type="button"
      className="cite-ref"
      title={label}
      aria-label={`Open source ${number}: ${label}`}
      disabled={!citation}
      onClick={() => citation && onCite?.(citation, number - 1)}
    >
      {number}
    </button>
  );
}

function renderInline(text, ctx, keyPrefix) {
  const out = [];
  let last = 0;
  let i = 0;
  for (const match of text.matchAll(INLINE)) {
    const token = match[0];
    if (match.index > last) out.push(text.slice(last, match.index));
    const key = `${keyPrefix}-${i++}`;
    if (token.startsWith("**")) {
      out.push(<strong key={key}>{renderInline(token.slice(2, -2), ctx, key)}</strong>);
    } else if (token.startsWith("`")) {
      out.push(<code key={key}>{token.slice(1, -1)}</code>);
    } else if (/^\[[^\]]+\]\(/.test(token)) {
      const [, label, href] = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/) || [];
      out.push(<a key={key} href={href} target="_blank" rel="noopener noreferrer">{label}</a>);
    } else if (token.startsWith("[")) {
      const numbers = [...token.matchAll(/\d+/g)].map((m) => Number(m[0]));
      out.push(
        <span key={key} className="cite-group">
          {numbers.map((n, j) => (
            <CiteRef key={`${key}-${j}`} number={n} citation={ctx.citations?.[n - 1]} onCite={ctx.onCite} />
          ))}
        </span>,
      );
    } else {
      out.push(<em key={key}>{renderInline(token.slice(1, -1), ctx, key)}</em>);
    }
    last = match.index + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function parseBlocks(source) {
  const lines = String(source || "").replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let para = [];
  const flush = () => {
    if (para.length) blocks.push({ type: "p", text: para.join(" ") });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed.startsWith("```")) {
      flush();
      const code = [];
      for (i += 1; i < lines.length && !lines[i].trim().startsWith("```"); i++) code.push(lines[i]);
      blocks.push({ type: "code", text: code.join("\n") });
      continue;
    }
    if (!trimmed) { flush(); continue; }
    if (trimmed.startsWith("|")) {
      flush();
      const rows = [];
      for (; i < lines.length && lines[i].trim().startsWith("|"); i++) {
        const cells = lines[i].trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
        if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue; // header separator
        rows.push(cells);
      }
      i -= 1;
      if (rows.length) blocks.push({ type: "table", head: rows[0], rows: rows.slice(1) });
      continue;
    }
    const heading = trimmed.match(/^(#{1,4})\s+(.*)$/);
    if (heading) { flush(); blocks.push({ type: `h${Math.min(4, heading[1].length + 2)}`, text: heading[2] }); continue; }
    const bullet = trimmed.match(/^[-*•]\s+(.*)$/);
    const ordered = trimmed.match(/^(\d+)[.)]\s+(.*)$/);
    if (bullet || ordered) {
      flush();
      const type = bullet ? "ul" : "ol";
      const prev = blocks[blocks.length - 1];
      const item = bullet ? bullet[1] : ordered[2];
      if (prev?.type === type) prev.items.push(item);
      else blocks.push({ type, items: [item], start: ordered ? Number(ordered[1]) : undefined });
      continue;
    }
    if (trimmed.startsWith(">")) { flush(); blocks.push({ type: "quote", text: trimmed.replace(/^>\s?/, "") }); continue; }
    if (/^note:/i.test(trimmed)) { flush(); blocks.push({ type: "note", text: trimmed }); continue; }
    para.push(trimmed);
  }
  flush();
  return blocks;
}

export default function MarkdownAnswer({ text, citations = [], onCite, className = "" }) {
  const ctx = { citations, onCite };
  return (
    <div className={`md-answer ${className}`}>
      {parseBlocks(text).map((block, i) => {
        const key = `b${i}`;
        switch (block.type) {
          case "h3": return <h3 key={key}>{renderInline(block.text, ctx, key)}</h3>;
          case "h4": return <h4 key={key}>{renderInline(block.text, ctx, key)}</h4>;
          case "h5":
          case "h6": return <h5 key={key}>{renderInline(block.text, ctx, key)}</h5>;
          case "ul": return <ul key={key}>{block.items.map((item, j) => <li key={j}>{renderInline(item, ctx, `${key}-${j}`)}</li>)}</ul>;
          case "ol": return <ol key={key} start={block.start}>{block.items.map((item, j) => <li key={j}>{renderInline(item, ctx, `${key}-${j}`)}</li>)}</ol>;
          case "code": return <pre key={key}><code>{block.text}</code></pre>;
          case "table":
            return (
              <div key={key} className="md-table-wrap">
                <table>
                  <thead><tr>{block.head.map((cell, j) => <th key={j}>{renderInline(cell, ctx, `${key}-h${j}`)}</th>)}</tr></thead>
                  <tbody>
                    {block.rows.map((row, r) => (
                      <tr key={r}>{row.map((cell, j) => <td key={j}>{renderInline(cell, ctx, `${key}-${r}-${j}`)}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case "quote": return <blockquote key={key}>{renderInline(block.text, ctx, key)}</blockquote>;
          case "note": return <p key={key} className="md-note">{renderInline(block.text, ctx, key)}</p>;
          default: return <p key={key}>{renderInline(block.text, ctx, key)}</p>;
        }
      })}
    </div>
  );
}
