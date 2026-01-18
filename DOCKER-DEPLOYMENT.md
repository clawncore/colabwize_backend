# Docker Deployment for Render

This directory contains Docker deployment configuration for ColabWize Backend with full PDF support.

## 🎯 What's Included

- **LibreOffice** - PDF → DOCX conversion with formatting preservation
- **Google Chrome** - Puppeteer PDF exports
- **Node.js 20** - Latest LTS runtime
- **Optimized Build** - Fast, cached deployments

## 📁 Files

```
backend/
├── Dockerfile              # Production Docker image
├── .dockerignore          # Build optimization
├── render.yaml            # Render service config
└── scripts/
    └── check-environment.js  # Dependency verification
```

## 🚀 Quick Deploy

```bash
# 1. Commit files
git add Dockerfile .dockerignore render.yaml
git commit -m "Add Docker deployment with PDF support"

# 2. Push to GitHub
git push origin main

# 3. Deploy on Render
# - Go to https://dashboard.render.com
# - Create Web Service from repo
# - Add environment variables (see deployment-summary.md)
```

## 🔍 Verify Dependencies

After deployment, run:

```bash
npm run check-env
```

Expected output:
```
✅ LibreOffice Available
✅ Google Chrome Available
✅ All dependencies are available!
```

## 📊 What This Enables

### PDF Uploads
- Full content extraction
- Image preservation
- Table formatting
- Style preservation

### PDF Exports  
- Professional PDF generation
- Charts and graphs
- Custom formatting
- QR codes and watermarks

## 🔧 Environment Variables

Required variables:
- `DATABASE_URL` - Supabase connection
- `SUPABASE_URL` - Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` - Admin access
- `LEMONSQUEEZY_API_KEY` - Payment processing
- See `deployment-summary.md` for full list

## 📚 Documentation

- [deployment-summary.md](file:///C:/Users/SIMBY/.gemini/antigravity/brain/6c3c4770-fa66-4376-95dd-e280d63e6b94/deployment-summary.md) - Quick reference
- [render-deployment.md](file:///C:/Users/SIMBY/.gemini/antigravity/brain/6c3c4770-fa66-4376-95dd-e280d63e6b94/render-deployment.md) - Detailed guide
- [pdf-upload-fix.md](file:///C:/Users/SIMBY/.gemini/antigravity/brain/6c3c4770-fa66-4376-95dd-e280d63e6b94/pdf-upload-fix.md) - PDF handling explanation

## 🐛 Troubleshooting

### PDF Upload Shows "Content from..."
- LibreOffice not installed
- Run: `libreoffice --version` in Render shell

### PDF Export Fails
- Chrome missing or misconfigured
- Check: `echo $PUPPETEER_EXECUTABLE_PATH`

### Build Timeout
- Render free tier may be too slow
- Upgrade to Starter plan ($7/month)

## ⚙️ Build Information

**First Build**: ~5-7 minutes
**Subsequent**: ~2-3 minutes (cached)
**Image Size**: ~1.5-2 GB

## ✅ Testing

After deployment:

```bash
# Health check
curl https://api.colabwize.com/health

# Test PDF upload
Upload a PDF via frontend → Should show full content

# Test PDF export
Create document → Export as PDF → Should download
```

## 🎉 Success Criteria

- [x] Dockerfile created
- [x] .dockerignore optimized
- [x] render.yaml configured
- [ ] Pushed to GitHub
- [ ] Deployed on Render
- [ ] Environment variables set
- [ ] PDF upload working
- [ ] PDF export working

---

**Need Help?** See the detailed guides in the brain directory or check Render logs for specific errors.
