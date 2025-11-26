#!/usr/bin/env node

/**
 * Test Script: SalesGodCRM → HubSpot Webhook Integration
 * 
 * Usage:
 *   node test-webhook.js --url http://localhost:3000 --email test@example.com
 *   node test-webhook.js --url https://your-domain.com --email newlead@company.com
 * 
 * This script simulates SalesGodCRM webhook payloads to test your integration locally
 */

const http = require('http');
const https = require('https');
const crypto = require('crypto');
const args = require('minimist')(process.argv.slice(2));

// Configuration
const WEBHOOK_URL = args.url || 'http://localhost:3000';
const WEBHOOK_SECRET = args.secret || '';
const TEST_EMAIL = args.email || 'test.lead@example.com';
const WEBHOOK_PATH = '/webhook/salesgodscrm';

// Parse URL
const parsedUrl = new URL(WEBHOOK_PATH, WEBHOOK_URL);
const isSecure = parsedUrl.protocol === 'https:';
const client = isSecure ? https : http;

// ============================================================================
// Test Payload 1: New Contact
// ============================================================================
const testPayload1 = {
  event: 'contact.created',
  data: {
    id: `sgcrm_${Date.now()}`,
    email: TEST_EMAIL,
    firstName: 'Test',
    lastName: 'Lead',
    phoneNumber: '+1-555-0123',
    company: 'Test Company'
  },
  timestamp: new Date().toISOString()
};

// ============================================================================
// Test Payload 2: Contact Update
// ============================================================================
const testPayload2 = {
  event: 'contact.updated',
  data: {
    id: `sgcrm_${Date.now()}`,
    email: TEST_EMAIL,
    firstName: 'Updated',
    lastName: 'Lead',
    phoneNumber: '+1-555-0124',
    company: 'Updated Company'
  },
  timestamp: new Date().toISOString()
};

// ============================================================================
// Helper: Send Webhook
// ============================================================================
function sendWebhook(payload, callback) {
  const payloadString = JSON.stringify(payload);
  
  // Generate HMAC signature if secret is provided
  const headers = {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payloadString)
  };

  if (WEBHOOK_SECRET) {
    const signature = crypto
      .createHmac('sha256', WEBHOOK_SECRET)
      .update(payloadString)
      .digest('hex');
    headers['x-webhook-signature'] = signature;
  }

  const options = {
    hostname: parsedUrl.hostname,
    port: parsedUrl.port || (isSecure ? 443 : 80),
    path: parsedUrl.pathname,
    method: 'POST',
    headers: headers
  };

  const req = client.request(options, (res) => {
    let data = '';

    res.on('data', (chunk) => {
      data += chunk;
    });

    res.on('end', () => {
      callback(null, {
        statusCode: res.statusCode,
        headers: res.headers,
        body: data
      });
    });
  });

  req.on('error', (error) => {
    callback(error, null);
  });

  req.write(payloadString);
  req.end();
}

// ============================================================================
// Run Tests
// ============================================================================
console.log('🚀 Testing SalesGodCRM → HubSpot Webhook Integration\n');
console.log(`Target URL: ${WEBHOOK_URL}${WEBHOOK_PATH}`);
console.log(`Test Email: ${TEST_EMAIL}`);
console.log(`HMAC Verification: ${WEBHOOK_SECRET ? 'ENABLED' : 'DISABLED'}\n`);

// Test 1: New Contact
console.log('📨 Test 1: Sending new contact webhook...');
sendWebhook(testPayload1, (error, response) => {
  if (error) {
    console.error('❌ Test 1 Failed:', error.message);
    return;
  }

  console.log(`✅ Test 1 Response: ${response.statusCode}`);
  try {
    const body = JSON.parse(response.body);
    console.log('Response:', JSON.stringify(body, null, 2));
  } catch (e) {
    console.log('Response:', response.body);
  }

  // Test 2: Update Contact (wait 2 seconds)
  setTimeout(() => {
    console.log('\n📨 Test 2: Sending contact update webhook...');
    sendWebhook(testPayload2, (error, response) => {
      if (error) {
        console.error('❌ Test 2 Failed:', error.message);
        return;
      }

      console.log(`✅ Test 2 Response: ${response.statusCode}`);
      try {
        const body = JSON.parse(response.body);
        console.log('Response:', JSON.stringify(body, null, 2));
      } catch (e) {
        console.log('Response:', response.body);
      }

      console.log('\n✅ All tests completed!');
    });
  }, 2000);
});
