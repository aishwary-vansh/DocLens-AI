// Helpers for the Markdown of generated reports (see components/research/CitedReport.jsx).

/** Drop a trailing "## Sources" section; the source list below replaces it. */
export function stripSourcesSection(markdown = "") {
  const index = markdown.search(/^##\s+Sources\s*$/m);
  return index >= 0 ? markdown.slice(0, index).trimEnd() : markdown;
}

/** Saved reviews keep only the Markdown, whose Sources section lists
 *  `n. Title, page P: "excerpt"` (rag/synthesis._review_markdown and the backend
 *  markdownForReview). Parse it back so [n] markers stay clickable. */
export function parseSourcesSection(markdown = "") {
  const index = markdown.search(/^##\s+Sources\s*$/m);
  if (index < 0) return [];
  return markdown
    .slice(index)
    .split("\n")
    .map((line) => line.match(/^\s*(\d+)\.\s+(.*),\s*page\s+([^:\s]+):\s*"?(.*?)"?\s*$/i))
    .filter(Boolean)
    .map(([, , title, page, excerpt]) => ({
      documentTitle: title.trim(),
      pageNumber: /^\d+$/.test((page || "").trim()) ? Number(page) : undefined,
      chunk: excerpt,
    }));
}
