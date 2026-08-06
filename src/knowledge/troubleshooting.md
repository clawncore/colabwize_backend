# ColabWize — Troubleshooting Guide

## Authentication Issues

### "Email not confirmed" after signup
- **Cause:** Supabase propagation delay (usually resolves in 1-2 minutes)
- **Fix:** Wait 2 minutes, then try signing in again. If still failing, click "Resend verification email" on the login page.
- **Escalation:** If persists after 5 minutes, check Supabase dashboard for the user record.

### "Invalid login credentials"
- **Cause:** Wrong email or password
- **Fix:** Use "Forgot Password" flow at `/forgot-password`. Check for typos. Ensure caps lock is off.
- **Note:** Password must be 8+ chars, 1 uppercase, 1 number, 1 special character.

### 2FA code not working
- **Cause:** Time sync issue with authenticator app
- **Fix:** Ensure device clock is set to automatic. Try entering the code immediately after it appears (codes rotate every 30 seconds).
- **Recovery:** After 3 failed attempts, use one of the 8-character recovery codes provided during 2FA setup.

### Google/Microsoft login fails
- **Cause:** OAuth session timeout or popup blocked
- **Fix:** Allow popups for colabwize.com. Clear browser cache. Try again.
- **Note:** If "Lock broken" error appears, it's a React StrictMode issue — safe to ignore, retry.

### "This email domain is not allowed"
- **Cause:** Email provider not in allowlist
- **Allowed domains:** gmail.com, outlook.com, hotmail.com, yahoo.com, icloud.com, aol.com, protonmail.com, mail.com, zoho.com, yandex.com, gmx.com, live.com, msn.com, qq.com, 163.com, 126.com, sina.com, sohu.com, edu.cn, ac.uk, ac.in, edu.au, edu.ca, colabwize.com
- **Fix:** Use an allowed email domain, or contact support to request adding your institution's domain.

## Document Issues

### Document not saving
- **Cause:** CRDT sync conflict or network interruption
- **Fix:** Refresh the page (auto-save preserves most work). Check internet connection. If persistent, check if Hocuspocus server is running.
- **Prevention:** Enable auto-save. Work with stable internet.

### PDF upload fails
- **Cause:** File exceeds size limit or unsupported format
- **Size limits:** Free: 5MB, Plus: 50MB, Premium: 100MB
- **Supported:** PDF, DOCX
- **Fix:** Compress the PDF or split into smaller files. Convert DOCX to PDF if having issues.

### PDF chat not answering questions
- **Cause:** PDF too complex or scanned image (no text layer)
- **Fix:** Ensure PDF has selectable text. Scanned PDFs need OCR first. Try simpler, more specific questions.
- **Note:** GROBID parser may struggle with heavily formatted academic papers.

### Citation audit shows low confidence
- **Cause:** Citations not in verification databases, or formatting issues
- **Fix:** Check that citations are complete (author, title, year, journal). Ensure standard formatting (APA, MLA, Chicago).
- **Note:** Non-English sources and very recent papers may not be in databases yet.

### Certificate generation fails
- **Cause:** Puppeteer timeout (resource-intensive)
- **Fix:** Try again in 30 seconds. Ensure document has edit history (time tracking must be enabled).
- **Note:** Each certificate launches a Chrome instance — takes 5-10 seconds normally.

## Collaboration Issues

### Can't see teammate's cursor
- **Cause:** WebSocket connection issue
- **Fix:** Refresh the page. Check internet connection. Ensure both users have the document open.
- **Note:** Uses y-webrtc (peer-to-peer) with y-websocket fallback.

### Workspace invitation not received
- **Cause:** Email delivery delay or spam filter
- **Fix:** Check spam folder. Verify email address is correct. Resend invitation from workspace settings.
- **Note:** Invitations use the format: `colabwize.com/workspaces/accept/:token`

### Real-time sync feels slow
- **Cause:** Network latency or server load
- **Fix:** Use a stable internet connection. Close unnecessary browser tabs. Try a different browser.
- **Note:** CRDTs are eventually consistent — minor delays are normal.

## Billing Issues

### "Plan limit reached" error
- **Cause:** Monthly quota exhausted for the feature
- **Fix:** Upgrade your plan, or wait until next billing cycle for quota reset.
- **Free quotas:** 3 scans/month, 3 rephrases/month, 5 AI chat messages, 25 paper searches
- **Note:** Credit packs can extend limits (never expire).

### Payment failed
- **Cause:** Card declined or insufficient funds
- **Fix:** Update payment method in Settings > Billing. Try a different card. Contact billing@colabwize.com.
- **Note:** We accept Visa, Mastercard, Amex, PayPal via LemonSqueezy.

### Want a refund
- **Policy:** Full refund within 7 days of purchase. Pro-rated refund for annual plans.
- **How:** Email billing@colabwize.com with your account email and reason.
- **Timeline:** Refunds process within 5-7 business days.

### Invoice not received
- **Fix:** Check spam folder. Download from Settings > Billing > Invoices. Contact billing@colabwize.com.

## Export Issues

### PDF export looks wrong
- **Cause:** Complex formatting not supported in PDF conversion
- **Fix:** Simplify formatting. Use standard fonts. Avoid custom CSS. Try DOCX export instead.

### BibTeX/RIS export empty
- **Cause:** No citations in document, or citation format not recognized
- **Fix:** Ensure citations are properly formatted. Add citations using the citation tool, not manual text.

## Performance Issues

### App feels slow
- **Fix:** Clear browser cache. Close other tabs. Disable browser extensions (especially Grammarly — conflicts with editor).
- **Note:** Large documents (100+ pages) may load slowly due to CRDT initialization.

### Browser not supported
- **Supported:** Chrome, Firefox, Safari (latest versions), Edge
- **Not supported:** Opera Mini, UC Browser, very old browser versions
- **Fix:** Update browser to latest version.

## Security Issues

### Suspicious activity on account
- **Fix:** Change password immediately. Enable 2FA. Check login history in Settings > Security. Contact support if unauthorized access suspected.

### Account locked
- **Cause:** Too many failed login attempts
- **Fix:** Wait 15 minutes and try again. Use "Forgot Password" if needed.
- **Escalation:** Contact support@colabwize.com if locked out.

## General Tips

1. **Bookmark** `colabwize.com/dashboard` for quick access
2. **Enable 2FA** in Settings > Security for account protection
3. **Use Chrome** for best compatibility
4. **Disable Grammarly** when using the editor (causes conflicts)
5. **Save frequently** — auto-save is on but manual Ctrl+S is good practice
6. **Contact support** at support@colabwize.com for issues not covered here
