# ColabWize — Features Guide

## 1. Citation Verification / Citation Audit
**Route:** `/dashboard/citation-audit`
**API:** `POST /api/citations/audit`, `POST /api/citations/audit/unified`

What it does:
- Parses PDF metadata using GROBID
- Extracts citations from document text
- Verifies against CrossRef, PubMed, ArXiv, OpenAlex databases
- Checks for retracted papers
- Detects duplicate citations
- Validates citation URLs
- Checks citation formatting (APA, MLA, Chicago)
- Classifies citation roles
- Produces a confidence score (0-100)

Limits:
- Free: 3 scans/month, 20k characters per document
- Plus: Citation confidence analysis included
- Premium: 100 audits/month, 200k characters per document

Common issues:
- GROBID server timeout (external dependency)
- Complex PDFs may not parse correctly
- Non-English citations may have lower accuracy

## 2. Authorship Certificate
**Route:** `/dashboard/certificate`
**API:** `POST /api/certificates/`

What it does:
- Generates PDF certificate proving you wrote the document
- Includes: timestamped edit history, manual effort verification, QR-coded verification link
- Certificate types: authorship, originality, completion
- Verification URL: `https://colabwize.com/verify/:id` (public, no auth needed)
- Uses Puppeteer to generate PDF (takes 5-10 seconds)

Limits:
- Free: Preview only (watermarked)
- Plus: Professional certificate generation
- Premium: Institution-grade certificates

## 3. AI Detection
**Route:** `/dashboard/ai-detection`
**API:** `POST /api/ai-detection/scan`

What it does:
- Scans text using GPTZero
- Classifies each sentence: human, likely_human, likely_ai, ai
- Overall classification: human, mixed, ai
- Shows confidence percentages

## 4. Originality / Plagiarism Checking
**Route:** `/dashboard/originality`
**API:** `POST /api/originality/scan`

What it does:
- Scans for plagiarism against web sources
- Detects self-plagiarism (comparing against your own work)
- Shows match classifications: green (safe), yellow (paraphrase), red (plagiarism), blue (quote)
- Provides rephrase suggestions
- "Active Defense" — real-time section risk check while writing
- Text humanization (rewrite AI-sounding text to sound human)

Limits:
- Free: 3 document scans/month, 20k character max
- Plus: 50MB file size
- Premium: 100MB file size, priority scanning

## 5. Real-Time Collaboration
**Route:** Any document in workspace

What it does:
- Live cursor visibility (see where teammates are typing)
- Integrated team chat
- Permission-based access (viewer, editor, admin)
- Built on Tiptap editor with Yjs CRDTs

## 6. Chat with PDFs
**Route:** `/dashboard/pdf-chat/:pdfId`
**API:** `/api/pdf/`

What it does:
- Upload PDF and ask natural language questions
- AI answers using document content with citations
- Multi-document synthesis (ask across multiple PDFs)

Limits:
- Free: 5 AI chat messages
- Plus: Unlimited PDF chats
- Premium: Chat with My Projects (unlimited)

## 7. Team Workspaces
**Route:** `/dashboard/workspace/:id/`

What it includes:
- Overview dashboard
- Kanban board for tasks
- Project management
- File storage
- Analytics
- Notifications
- Templates

Limits:
- Free: 1 workspace, 2 collaborators
- Plus: 5 workspaces, 10 collaborators each
- Premium: Unlimited workspaces and collaborators

## 8. Grammar Checking
**API:** `POST /api/grammar/check`

What it does:
- Checks spelling, grammar, style, capitalization, punctuation
- Provides inline suggestions

## 9. Research Tools
**Routes:** `/dashboard/research`

Features:
- APA, MLA, Chicago citation generators
- Research vault (save and organize sources)
- Insight map (visualize research connections)
- Research gaps detection
- Search alerts (get notified when new papers match your criteria)
- Paper search across CrossRef, PubMed, ArXiv, OpenAlex

## 10. Publishing / Export
**API:** Various

Export formats:
- DOCX (Microsoft Word)
- PDF
- BibTeX / RIS (reference managers)

## 11. Time Tracking
Tracks writing session duration for authorship evidence. Runs in background while you write.

## 12. Reference Manager Integration
- Zotero (full integration)
- Mendeley (full integration)
- EndNote (via BibTeX/RIS import)
- Google Drive (import)
- Microsoft OneDrive (import)

## 13. Draft Comparison
**API:** `POST /api/originality/compare`

Compares two document versions:
- Similarity score
- Overlap percentage
- Matched segments
- Semantic drift detection

## 14. Admin Panel (Titan)
**Route:** `/admin/`

Admin features:
- Dashboard with metrics
- User management
- Email center (compose, send, logs, analytics)
- Inbox (support messages)
- Blog CMS
- Revenue analytics
- System health monitoring
- Marketing hub
- Platform settings
- Security monitoring
