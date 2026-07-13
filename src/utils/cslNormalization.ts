/**
 * Unified CSL-JSON normalization utility.
 * Ensures that citation data conforms to the strict requirements of Pandoc's citeproc.
 */

export interface CSLAuthor {
  family?: string;
  given?: string;
  literal?: string;
}

export interface CSLDate {
  'date-parts': Array<number[]>;
  literal?: string;
}

export interface CSLItem {
  id: string;
  type: string;
  title: string;
  author: CSLAuthor[];
  issued: CSLDate;
  DOI?: string;
  URL?: string;
  container_title?: string;
  volume?: string;
  issue?: string;
  page?: string;
  publisher?: string;
  abstract?: string;
  [key: string]: any;
}

export function normalizeToCSL(input: any): CSLItem {
  if (!input) return { id: "unknown", type: "article-journal", title: "Unknown", author: [{ literal: "Unknown" }], issued: { "date-parts": [[new Date().getFullYear()]] } };
  
  let data = input;
  // If we received a string, try to parse it as JSON
  if (typeof input === 'string') {
    try {
      data = JSON.parse(input);
    } catch (e) {
      // If it's not valid JSON, treat it as the raw reference text
      data = { raw_reference_text: input };
    }
  }

  // Ensure data is an object
  if (typeof data !== 'object' || data === null) {
    data = { title: String(data) };
  }
  
  const item: any = {};
  
  // 1. Mandatory ID
  item.id = String(data.ref_key || data.id || `ref_${Math.random().toString(36).substr(2, 9)}`);

  // 2. Mandatory Title
  item.title = data.title || data.raw_reference_text || "Untitled";

  // 3. Mandatory Type
  const validTypes = ["article-journal", "book", "chapter", "dataset", "paper-conference", "report", "thesis", "webpage"];
  item.type = (data.type && validTypes.includes(data.type)) ? data.type : "article-journal";

  // 4. Name Fields (Must be Arrays of Objects)
  const nameFields = ["author", "editor", "translator", "recipient", "interviewer", "composer", "original-author", "director", "script-writer", "producer", "collection-editor", "editorial-director", "illustrator", "artist", "reviewed-author"];
  
  nameFields.forEach(field => {
    let rawValue = data[field] || (field === "author" ? data.authors : undefined);
    if (!rawValue) return;

    // Handle strings that might contain multiple authors (e.g., "Author 1, Author 2" or "A. 1; A. 2")
    if (typeof rawValue === 'string') {
      const separators = [';', ','];
      let parts = [rawValue];
      if (rawValue.includes(';') || (rawValue.includes(',') && rawValue.split(',').length > 1)) {
        const sep = rawValue.includes(';') ? ';' : ',';
        parts = rawValue.split(sep).map(p => p.trim()).filter(Boolean);
      }
      item[field] = parts.map(p => ({ literal: p }));
    } else if (Array.isArray(rawValue)) {
      item[field] = [];
      rawValue.forEach((a: any) => {
        if (typeof a === 'string') {
          // Even as an array element, a string might contain multiple names from some APIs
          if (a.includes(';') || (a.includes(',') && a.split(',').length > 1)) {
            const sep = a.includes(';') ? ';' : ',';
            a.split(sep).forEach(p => {
              if (p.trim()) item[field].push({ literal: p.trim() });
            });
          } else {
            item[field].push({ literal: a });
          }
        } else {
          item[field].push(a);
        }
      });
    } else if (typeof rawValue === 'object') {
      item[field] = [rawValue];
    }
  });

  if (!item.author || item.author.length === 0) {
    item.author = [{ literal: "Unknown Author" }];
  }

  // 5. Issued Date (Strict Object with date-parts containing Numbers)
  if (data.issued && typeof data.issued === 'object' && data.issued['date-parts']) {
    item.issued = data.issued;
  } else {
    const yearStr = String(data.year || data.issued || "").match(/\d{4}/)?.[0];
    const year = yearStr ? parseInt(yearStr) : new Date().getFullYear();
    item.issued = { 'date-parts': [[year]] };
  }

  // 6. Scalar Whitelist (Strings or Numbers)
  const scalarFields = ["DOI", "URL", "doi", "url", "ISBN", "isbn", "container-title", "volume", "issue", "page", "publisher", "abstract", "collection-title", "journal", "pages"];
  scalarFields.forEach(field => {
    if (data[field] !== undefined && (typeof data[field] === "string" || typeof data[field] === "number")) {
      // Map common database fields to CSL standard
      let targetField = field;
      if (field === "doi") targetField = "DOI";
      if (field === "url") targetField = "URL";
      if (field === "isbn") targetField = "ISBN";
      if (field === "journal") targetField = "container-title";
      if (field === "pages") targetField = "page";
      
      item[targetField] = String(data[field]);
    }
  });

  return item as CSLItem;
}
