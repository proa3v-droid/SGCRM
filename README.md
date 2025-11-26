# SalesGodCRM → HubSpot Integration

Webhook receiver that syncs contacts from SalesGodCRM to HubSpot.

## Deployment Instructions

### Option 1: Railway (Recommended)

1. Install Railway CLI:
   ```powershell
   npm install -g @railway/cli
   ```

2. Login to Railway:
   ```powershell
   railway login
   ```

3. Initialize and deploy:
   ```powershell
   railway init
   railway up
   ```

4. Add environment variables:
   ```powershell
   railway variables set HUBSPOT_API_KEY=your_hubspot_api_key_here
   ```

5. Get your public URL:
   ```powershell
   railway domain
   ```

### Option 2: Render

1. Go to [render.com](https://render.com)
2. Connect your GitHub repository
3. Create new Web Service
4. Set environment variables in Render dashboard
5. Deploy

### Option 3: Manual Server

1. Upload files to your server
2. Install dependencies: `npm install`
3. Set environment variables
4. Run with PM2: `pm2 start integratiom.js`

## Environment Variables

Set these in your deployment platform:

- `HUBSPOT_API_KEY` - Your HubSpot API key
- `PORT` - Server port (optional, defaults to 3000)
- `WEBHOOK_SECRET` - Optional webhook verification secret

## Webhook URL

After deployment, configure SalesGodCRM to send webhooks to:
```
https://your-domain.com/webhook/salesgodscrm
```

## Testing

```powershell
node test-webhook.js --url https://your-domain.com --email test@example.com
```
