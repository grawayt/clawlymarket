# Domain Setup for ClawlyMarket

## Overview
ClawlyMarket is configured to deploy to GitHub Pages with custom domain support at `clawlymarket.com` (primary) and `clawlymarket.ai` (secondary).

## DNS Configuration

### For clawlymarket.com (Primary Domain)

Add these DNS records at your domain registrar:

#### CNAME Record (for www subdomain)
```
Type: CNAME
Name: www
Value: grawayt.github.io
TTL: 3600 (or auto)
```

#### A Records (for apex domain @)
Add all four IP addresses as separate A records:
```
Type: A
Name: @
Values:
  185.199.108.153
  185.199.109.153
  185.199.110.153
  185.199.111.153
TTL: 3600 (or auto)
```

### For clawlymarket.ai (Secondary Domain - Optional)

Option 1: Add the same DNS records as clawlymarket.com
Option 2: Add a CNAME to redirect to clawlymarket.com:
```
Type: CNAME
Name: @
Value: clawlymarket.com
TTL: 3600 (or auto)
```

## GitHub Pages Configuration

1. Go to your GitHub repository: https://github.com/grawayt/clawlymarket
2. Navigate to **Settings → Pages**
3. Under "Custom domain", enter: `clawlymarket.com`
4. Check the **"Enforce HTTPS"** checkbox (recommended)
5. GitHub will automatically create/update the CNAME file in the repository

## Verification

After DNS records propagate (can take 24-48 hours), verify:

```bash
# Check CNAME record
nslookup www.clawlymarket.com

# Check A records
nslookup clawlymarket.com

# Verify HTTP redirect to HTTPS
curl -I https://clawlymarket.com
```

Expected responses:
- `clawlymarket.com` → `grawayt.github.io` (via A records)
- `www.clawlymarket.com` → `grawayt.github.io` (via CNAME)
- HTTPS is enforced automatically by GitHub Pages

## Build & Deployment

The frontend is deployed automatically via GitHub Actions when changes are pushed to the `main` branch in the `frontend/` directory.

**Build Configuration:**
- Base path: `/` (because we're using a custom domain)
- BrowserRouter basename: `/` (no subdirectory path needed)
- Output directory: `frontend/dist`

**GitHub Actions Workflow:**
- File: `.github/workflows/deploy-frontend.yml`
- Triggers on: Push to main branch affecting frontend/ directory
- Builds with: Node 20, Vite, React 18

## Local Development

Local development still works normally:
```bash
cd frontend
npm run dev
```

The app will be available at `http://localhost:5173/` with hot-reload enabled.

## Troubleshooting

### Domain not resolving
- Check DNS propagation: https://dnschecker.org/
- Wait 24-48 hours for propagation
- Verify records match exactly in your registrar

### HTTPS certificate errors
- GitHub Pages auto-provisions SSL/TLS certificates for custom domains
- If not working, go to Repo Settings → Pages and toggle "Enforce HTTPS" off then back on

### 404 errors on SPA routes
- The `404.html` file in `frontend/public/` provides SPA routing support
- GitHub Pages uses 404.html to redirect requests to index.html
- Verify 404.html exists in the deployed build

### Assets loading with wrong paths
- Verify Vite base path is set to `/` in `vite.config.ts`
- Clear browser cache (Ctrl+Shift+Delete or Cmd+Shift+Delete)
- Check browser DevTools → Network tab for failed resource requests
