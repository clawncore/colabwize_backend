import { Project } from "@prisma/client";
import { SecretsService } from "./secrets-service";

interface HtmlExportOptions {
  citationStyle?: "apa" | "mla" | "chicago";
  includeCoverPage?: boolean;
  coverPageStyle?: "apa" | "mla";
  includeTOC?: boolean;
  metadata?: {
    author?: string;
    institution?: string;
    course?: string;
    instructor?: string;
    runningHead?: string;
  };
}

export class HtmlExportService {
  /**
   * meaningful styles for academic PDF export
   */
  private static getStyles(): string {
    return `
      @page {
        margin: 1in;
        size: letter;
      }
      body {
        font-family: "Times New Roman", Times, serif;
        font-size: 12pt;
        line-height: 2;
        color: #000;
        margin: 0;
        padding: 0;
      }
      p {
        margin: 0 0 1em 0; /* Add bottom margin for spacing */
        text-indent: 0.5in;
      }
      h1, h2, h3, h4, h5, h6 {
        font-weight: bold;
        margin-top: 1em; /* Add top margin */
        margin-bottom: 0.5em; /* Add bottom margin */
        text-indent: 0;
        text-align: center; 
      }
      h1 { font-size: 12pt; } 
      h2 { font-size: 12pt; } 
      /* APA headings logic can be complex, simplifying for MVP */
      
      .cover-page {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: 9in; /* Approximate centering on page */
        text-align: center;
        page-break-after: always;
      }
      .cover-page div {
        margin-bottom: 1em;
      }
      .toc {
        page-break-after: always;
      }
      .toc-title {
        text-align: center;
        font-weight: bold;
        margin-bottom: 1em;
      }
      .toc-item {
        margin-left: 0;
        text-indent: 0;
        display: flex;
        justify-content: space-between;
      }
      .page-break {
        page-break-after: always;
      }
      .references-title {
        text-align: center;
        font-weight: bold;
        margin-top: 0;
        margin-bottom: 2em;
        text-indent: 0;
      }
      .reference-item {
        text-indent: -0.5in; /* Hanging indent */
        margin-left: 0.5in;
        margin-bottom: 1em;
      }
      blockquote {
        margin-left: 0.5in;
        margin-right: 0;
        text-indent: 0;
      }
      /* Column layout support */
      .columns {
        display: flex;
        gap: 0.5in;
        margin: 0 0 1em 0;
      }
      .column {
        flex: 1;
        min-width: 0;
      }
      .column p {
        text-indent: 0;
      }
      /* Table support */
      table {
        width: 100%;
        border-collapse: collapse;
        margin: 1em 0;
        page-break-inside: avoid;
      }
      th, td {
        border: 1px solid #000;
        padding: 0.25em 0.5em;
        text-align: left;
        vertical-align: top;
        text-indent: 0;
      }
      th {
        font-weight: bold;
        background-color: #f0f0f0;
      }
    `;
  }

  /**
   * Generate full HTML for PDF export
   */
  static async generateProjectHtml(
    project: any, // Using any for Project to avoid strict Prisma type issues in this snippet
    options: HtmlExportOptions
  ): Promise<string> {
    let html = `<!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <style>${this.getStyles()}</style>
    </head>
    <body>`;

    // 1. Cover Page
    if (options.includeCoverPage) {
      html += this.generateCoverPage(project, options);
    }

    // 2. TOC (Placeholder - hard to do accurate page numbers in HTML before PDF render)
    // For MVP PDF via Puppeteer, TOC with page numbers is tricky without a multi-pass render.
    // We will skip TOC for now or just list headings without page numbers if strictly requested.
    // Ideally, we'd use a tool that supports generating TOC during PDF creation.

    // 3. Body Content
    html += `<div class="content">`;
    // Add title on first page of body if APA/MLA requires (usually yes)
    if (!options.includeCoverPage) {
      html += `<div style="text-align: center; font-weight: bold; margin-bottom: 1em; text-indent: 0;">${project.title}</div>`;
    }
    html += await this.convertTipTapToHtml(project.content);
    html += `</div>`;

    // 4. References
    if (project.citations && project.citations.length > 0) {
      html += `<div class="page-break"></div>`;
      html += `<div class="references-title">References</div>`;
      project.citations.forEach((citation: any) => {
        html += `<div class="reference-item">${this.formatCitation(citation, options.citationStyle || "apa")}</div>`;
      });
    }

    html += `</body></html>`;
    return html;
  }

  private static generateCoverPage(
    project: any,
    options: HtmlExportOptions
  ): string {
    const { metadata } = options;
    const author = metadata?.author || "Unknown Author";
    const institution = metadata?.institution || "";
    const course = metadata?.course || "";
    const instructor = metadata?.instructor || "";
    const date = new Date().toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });

    // Simple APA Styling for Cover Page
    return `
      <div class="cover-page">
        <div style="font-weight: bold; margin-bottom: 2em;">${project.title}</div>
        <div>${author}</div>
        ${institution ? `<div>${institution}</div>` : ""}
        ${course ? `<div>${course}</div>` : ""}
        ${instructor ? `<div>${instructor}</div>` : ""}
        <div>${date}</div>
      </div>
    `;
  }

  private static async convertTipTapToHtml(content: any): Promise<string> {
    if (!content || !content.content) return "";

    let html = "";

    for (const node of content.content) {
      if (node.type === "paragraph") {
        html += `<p>${this.extractTextHtml(node)}</p>`;
      } else if (node.type === "heading") {
        const level = node.attrs?.level || 1;
        html += `<h${level}>${this.extractTextHtml(node)}</h${level}>`;
      } else if (node.type === "blockquote") {
        html += `<blockquote>${this.extractTextHtml(node)}</blockquote>`;
      } else if (node.type === "bulletList") {
        html += `<ul>${await this.convertTipTapToHtml(node)}</ul>`;
      } else if (node.type === "orderedList") {
        html += `<ol>${await this.convertTipTapToHtml(node)}</ol>`;
      } else if (node.type === "listItem") {
        html += `<li>${await this.convertTipTapToHtml(node)}</li>`;
      } else if (node.type === "image") {
        let src = node.attrs?.src || "";
        const alt = node.attrs?.alt || "";

        // Resolve relative URLs
        if (src && !src.startsWith("http") && !src.startsWith("data:")) {
          const appUrl = await SecretsService.getAppUrl();
          src = src.startsWith("/") ? `${appUrl}${src}` : `${appUrl}/${src}`;
        }

        html += `<img src="${src}" alt="${alt}" style="max-width: 100%; height: auto; display: block; margin: 1em auto;" />`;
      } else if (node.type === "columns") {
        // Handle multi-column layout
        html += `<div class="columns">`;
        if (node.content) {
          for (const column of node.content) {
            if (column.type === "column") {
              html += `<div class="column">${await this.convertTipTapToHtml(column)}</div>`;
            }
          }
        }
        html += `</div>`;
      } else if (node.type === "table") {
        // Handle table
        html += `<table>`;
        if (node.content) {
          for (const row of node.content) {
            if (row.type === "tableRow") {
              html += `<tr>`;
              if (row.content) {
                for (const cell of row.content) {
                  if (cell.type === "tableHeader") {
                    html += `<th>${this.extractTextHtml(cell)}</th>`;
                  } else if (cell.type === "tableCell") {
                    html += `<td>${this.extractTextHtml(cell)}</td>`;
                  }
                }
              }
              html += `</tr>`;
            }
          }
        }
        html += `</table>`;
      }
    }

    return html;
  }

  private static extractTextHtml(node: any): string {
    if (!node.content) return "";
    let html = "";

    node.content.forEach((child: any) => {
      if (child.type === "text") {
        let childText = child.text || "";

        // Normalize newlines and unicode chars
        childText = childText
          .replace(/\r\n/g, "\n")
          .replace(/\r/g, "\n")
          .replace(/\u2028/g, "\n")
          .replace(/\u2029/g, "\n\n");

        // Replace newlines with <br> to preserve explicit breaks in text nodes
        childText = childText.replace(/\n/g, "<br>");

        // Handle marks (bold, italic, link, etc.)
        if (child.marks) {
          child.marks.forEach((mark: any) => {
            if (mark.type === "bold")
              childText = `<strong>${childText}</strong>`;
            if (mark.type === "italic") childText = `<em>${childText}</em>`;
            if (mark.type === "underline") childText = `<u>${childText}</u>`;
            if (mark.type === "code") childText = `<code>${childText}</code>`;
            if (mark.type === "link") {
              const href = mark.attrs?.href || "#";
              childText = `<a href="${href}" style="color:blue; text-decoration:underline;">${childText}</a>`;
            }
          });
        }
        html += childText;
      } else if (child.type === "hardBreak") {
        html += "<br>";
      }
    });

    return html || "&nbsp;"; // Return non-breaking space if empty to maintain height
  }

  private static formatCitation(citation: any, style: string): string {
    const authors = citation.authors || citation.author || "Unknown";
    const title = citation.title || "Untitled";
    const year = citation.year || "n.d.";

    if (style === "apa") {
      return `${authors} (${year}). <i>${title}</i>.`;
    } else if (style === "mla") {
      return `${authors}. "${title}." ${year}.`;
    }
    return `${authors}. ${title}. ${year}.`;
  }
}
