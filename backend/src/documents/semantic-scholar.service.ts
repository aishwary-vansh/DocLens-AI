import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class SemanticScholarService {
  private readonly logger = new Logger(SemanticScholarService.name);
  private readonly ssBaseUrl = 'https://api.semanticscholar.org/graph/v1/paper/search';
  private readonly crBaseUrl = 'https://api.crossref.org/works';

  async fetchPaperMetadata(title: string): Promise<{
    citationCount: number;
    authors: string[];
    year: number | null;
  } | null> {
    try {
      // 1. Try Semantic Scholar
      const ssUrl = `${this.ssBaseUrl}?query=${encodeURIComponent(title)}&limit=1&fields=title,authors,citationCount,year`;
      const ssResponse = await fetch(ssUrl);
      
      if (ssResponse.ok) {
        const data = await ssResponse.json();
        if (data.data && data.data.length > 0) {
          const paper = data.data[0];
          return {
            citationCount: paper.citationCount ?? 0,
            authors: paper.authors ? paper.authors.map((a: any) => a.name) : [],
            year: paper.year ?? null,
          };
        }
      } else if (ssResponse.status === 429) {
        this.logger.warn(`Semantic Scholar API rate limit exceeded for title: "${title}". Falling back to CrossRef.`);
      }

      // 2. Fallback to CrossRef
      const crUrl = `${this.crBaseUrl}?query.title=${encodeURIComponent(title)}&select=title,author,is-referenced-by-count,created&rows=1`;
      const crResponse = await fetch(crUrl);
      if (crResponse.ok) {
        const data = await crResponse.json();
        if (data.message?.items && data.message.items.length > 0) {
          const paper = data.message.items[0];
          const authors = paper.author ? paper.author.map((a: any) => `${a.given || ''} ${a.family || ''}`.trim()) : [];
          const year = paper.created?.['date-parts']?.[0]?.[0] ?? null;
          return {
            citationCount: paper['is-referenced-by-count'] ?? 0,
            authors,
            year,
          };
        }
      }

      this.logger.log(`No results found in Semantic Scholar or CrossRef for title: "${title}"`);
      return null;
    } catch (error: any) {
      this.logger.error(`Failed to fetch metadata for "${title}": ${error.message}`);
      return null;
    }
  }
}
