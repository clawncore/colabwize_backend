// @ts-nocheck
import { HtmlExportService } from '../src/services/htmlExportService';
import { HyperlinkInjector } from '../src/services/hyperlinkInjector';
import { CitationEngine } from '../src/services/citationEngine';
import * as fs from 'fs';
import puppeteer from 'puppeteer';

async function runTest() {
    console.log("Starting PDF Export Test...");

    // 1. Mock Project Data
    const mockProject = {
        title: "PDF Test Project",
        content: {
            type: "doc",
            content: [
                {
                    type: "paragraph",
                    content: [
                        { type: "text", text: "This is a paragraph with a " },
                        { type: "citation", attrs: { citationId: "ref_1" } },
                        { type: "text", text: " and another " },
                        { type: "citation", attrs: { citationId: "ref_2" } },
                        { type: "text", text: "." }
                    ]
                }
            ]
        },
        citations: [
            { id: "ref_1", type: "article-journal", title: "Article One", author: [{ family: "Smith", given: "J" }], issued: { "date-parts": [[2020]] }, DOI: "10.1000/1" },
            { id: "ref_2", type: "book", title: "Book Two", author: [{ family: "Doe", given: "A" }], issued: { "date-parts": [[2021]] } } // No URL/DOI -> Internal
        ]
    };

    // 2. Generate HTML with tokens
    console.log("Generating HTML...");
    let html = await HtmlExportService.generateProjectHtml(mockProject, {
        citationStyle: "apa",
        useCitationTokens: true,
        includeCoverPage: false
    });

    console.log("Initial HTML snippet:", html.substring(html.indexOf("citation"), html.indexOf("citation") + 100));

    // 3. Inject Hyperlinks
    console.log("Injecting Hyperlinks...");
    const engine = new CitationEngine(mockProject.citations, 'apa');
    await engine.initialize(); // Required to load styles/locales
    const injector = new HyperlinkInjector();
    html = await injector.injectHyperlinks(html, engine);

    console.log("Injected HTML snippet:", html.substring(html.indexOf("citation-link"), html.indexOf("citation-link") + 150));

    // 4. Render PDF
    console.log("Rendering PDF...");
    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    await page.emulateMediaType('print');
    await page.setContent(html, { waitUntil: "networkidle0" });
    const buffer = await page.pdf({
        format: "Letter",
        printBackground: true,
        margin: { top: "1in", bottom: "1in", left: "1in", right: "1in" }
    });
    await browser.close();

    // 5. Save Output
    fs.writeFileSync('test_output.pdf', buffer);
    console.log("PDF saved to test_output.pdf");
    console.log(`Size: ${buffer.length} bytes`);

    if (buffer.length > 0) {
        console.log("*** TEST PASSED ***");
    } else {
        console.log("*** TEST FAILED ***");
    }
}

runTest().catch(console.error);
