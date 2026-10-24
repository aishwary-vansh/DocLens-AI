// Reader for generated reports (literature reviews, comparisons): Markdown body
// whose [n] markers open the matching source below, plus a numbered source list
// with the supporting excerpt of the selected source.
import { useId, useState } from "react";
import MarkdownAnswer from "./MarkdownAnswer";
import { documentsApi } from "../../services/api";
import { parseSourcesSection, stripSourcesSection } from "../../utils/reportMarkdown";

export default function CitedReport({ markdown, citations: given = [], verification }) {
  const citations = given.length ? given : parseSourcesSection(markdown);
  const [selected, setSelected] = useState(null);
  const uid = useId();
  const open = (citation, index, fromMarker = false) => {
    setSelected((current) => (current === index && !fromMarker ? null : index));
    if (fromMarker) {
      // Bring the opened source into view when a [n] marker in the text was clicked.
      requestAnimationFrame(() => document.getElementById(`${uid}-src-${index}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
    }
  };

  return (
    <div className="cited-report">
      {verification?.checked > 0 && (
        <p className="cited-report-check">
          Checked: {verification.supported} of {verification.checked} cited sentences matched their sources
          {verification.misattributed ? `, ${verification.misattributed} may cite the wrong paper` : ""}
          {verification.unsupported ? `, ${verification.unsupported} did not match` : ""}.
        </p>
      )}

      <MarkdownAnswer text={citations.length ? stripSourcesSection(markdown) : markdown} citations={citations} onCite={(citation, index) => open(citation, index, true)} />

      {!!citations.length && (
        <section className="cited-report-sources" aria-label="Sources">
          <h3>Sources</h3>
          <ol>
            {citations.map((citation, index) => (
              <li key={`${citation.documentId}-${index}`} id={`${uid}-src-${index}`} className={selected === index ? "is-active" : ""}>
                <button type="button" onClick={() => open(citation, index)} aria-expanded={selected === index}>
                  <span className="source-card-num">{index + 1}</span>
                  <span className="cited-report-source-title">
                    {citation.documentTitle || "Untitled paper"}
                    <small>{citation.pageNumber ? `Page ${citation.pageNumber}` : "Page n/a"}</small>
                  </span>
                </button>
                {selected === index && (
                  <div className="cited-report-excerpt">
                    <blockquote>{citation.chunk || citation.sourceText || "Excerpt not available."}</blockquote>
                    {citation.documentId && (
                      <button
                        type="button"
                        className="cited-report-download"
                        onClick={() => documentsApi.download(citation.documentId, `${citation.documentTitle || "paper"}.pdf`)}
                      >
                        Download paper
                      </button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
