/**
 * SalesGodCRM → HubSpot Integration Webhook Handler
 * Receives contact webhooks from SalesGodCRM and updates HubSpot custom property
 * 
 * Setup:
 * 1. Set environment variables:
 *    - HUBSPOT_API_KEY: Your HubSpot private app API key
 *    - WEBHOOK_SECRET: Shared secret with SalesGodCRM for HMAC verification
 *    - PORT: Server port (default: 3000)
 * 
 * 2. Point SalesGodCRM webhook URL to: https://your-domain.com/webhook/salesgodscrm
 * 
 * 3. Deploy on a public HTTPS server (Vercel, Heroku, AWS Lambda, Railway, etc.)
 */

require('dotenv').config();

const express = require('express');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const axios = require('axios');

const app = express();
const PORT = parseInt(process.env.PORT) || 3000;

// Environment validation
const HUBSPOT_API_KEY = process.env.HUBSPOT_API_KEY;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

if (!HUBSPOT_API_KEY) {
  console.error('ERROR: HUBSPOT_API_KEY environment variable not set');
  process.exit(1);
}

// Parse JSON
app.use(bodyParser.json());

// ============================================================================
// HMAC Verification (if SalesGodCRM supports it)
// ============================================================================
function verifyWebhookSignature(req) {
  if (!WEBHOOK_SECRET) {
    console.warn('WARNING: WEBHOOK_SECRET not set, skipping HMAC verification');
    return true;
  }

  const signature = req.headers['x-webhook-signature'];
  if (!signature) {
    console.warn('No signature header found in webhook request');
    return false;
  }

  const payload = JSON.stringify(req.body);
  const hash = crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(payload)
    .digest('hex');

  return hash === signature;
}

// ============================================================================
// HubSpot API Client
// ============================================================================
const hubspotAPI = axios.create({
  baseURL: 'https://api.hubapi.com',
  headers: {
    'Authorization': `Bearer ${HUBSPOT_API_KEY}`,
    'Content-Type': 'application/json'
  }
});

// ============================================================================
// Get or Create Contact in HubSpot
// ============================================================================
async function getOrCreateHubSpotContact(email, contactData) {
  try {
    // Step 1: Search for contact by email
    const searchResponse = await hubspotAPI.post(
      '/crm/v3/objects/contacts/search',
      {
        filterGroups: [
          {
            filters: [
              {
                propertyName: 'email',
                operator: 'EQ',
                value: email
              }
            ]
          }
        ],
        limit: 1,
        sorts: ['-hs_object_id']
      }
    );

    if (searchResponse.data.results.length > 0) {
      // Contact exists
      return {
        found: true,
        contactId: searchResponse.data.results[0].id,
        properties: searchResponse.data.results[0].properties
      };
    }

    // Step 2: Create new contact if not found
    console.log(`Creating new HubSpot contact for ${email}`);

    const properties = {
      email: email,
      source_system: 'SGCRM', // Set source on creation
      ...(contactData.firstName && { firstname: contactData.firstName }),
      ...(contactData.lastName && { lastname: contactData.lastName }),
      ...(contactData.phone && { phone: contactData.phone }),
      ...(contactData.company && { company: contactData.company })
    };

    const createResponse = await hubspotAPI.post(
      '/crm/v3/objects/contacts',
      {
        properties: properties
      }
    );

    return {
      found: false,
      created: true,
      contactId: createResponse.data.id,
      properties: createResponse.data.properties
    };
  } catch (error) {
    console.error('Error getting/creating HubSpot contact:', error.response?.data || error.message);
    throw error;
  }
}

// ============================================================================
// Update Contact Property
// ============================================================================
async function updateHubSpotContact(contactId, propertiesToUpdate) {
  try {
    const response = await hubspotAPI.patch(
      `/crm/v3/objects/contacts/${contactId}`,
      {
        properties: propertiesToUpdate
      }
    );

    console.log(`Updated HubSpot contact ${contactId} with source_system property`);
    return response.data;
  } catch (error) {
    console.error('Error updating HubSpot contact:', error.response?.data || error.message);
    throw error;
  }
}

// ============================================================================
// Webhook Endpoints
// ============================================================================

// SalesGodCRM Webhook
app.post('/webhook/salesgodscrm', async (req, res) => {
  console.log('Received SalesGodCRM webhook');

  try {
    // Verify signature if secret is configured
    if (!verifyWebhookSignature(req)) {
      console.error('HMAC verification failed');
      return res.status(401).json({ error: 'Unauthorized: Invalid signature' });
    }

    // ========================================================================
    // Parse Webhook Payload
    // ========================================================================
    // Adjust these fields based on your actual SalesGodCRM webhook payload structure
    const {
      event,
      data,
      contact,
      email,
      phoneNumber,
      firstName,
      lastName,
      company,
      id: sgcrmId,
      timestamp
    } = req.body;

    // Validate minimum required fields
    const contactEmail = email || contact?.email || data?.email;
    if (!contactEmail) {
      console.error('Missing email in webhook payload');
      return res.status(400).json({
        error: 'Missing email in webhook payload',
        payload: req.body
      });
    }

    console.log(`Processing ${event || 'contact'} for ${contactEmail}`);

    // ========================================================================
    // Get or Create Contact in HubSpot
    // ========================================================================
    const contactInfo = {
      firstName: firstName || contact?.firstName || data?.firstName,
      lastName: lastName || contact?.lastName || data?.lastName,
      phone: phoneNumber || contact?.phoneNumber || data?.phoneNumber,
      company: company || contact?.company || data?.company
    };

    const hubspotContact = await getOrCreateHubSpotContact(contactEmail, contactInfo);
    const contactId = hubspotContact.contactId;

    // ========================================================================
    // Update source_system Property
    // ========================================================================
    // Build properties to update (always include source_system)
    const propertiesToUpdate = {
      source_system: 'SGCRM'
    };

    // Include additional fields from SalesGodCRM if they differ
    if (contactInfo.firstName && !hubspotContact.properties?.firstname?.value) {
      propertiesToUpdate.firstname = contactInfo.firstName;
    }
    if (contactInfo.lastName && !hubspotContact.properties?.lastname?.value) {
      propertiesToUpdate.lastname = contactInfo.lastName;
    }
    if (contactInfo.phone && !hubspotContact.properties?.phone?.value) {
      propertiesToUpdate.phone = contactInfo.phone;
    }
    if (contactInfo.company && !hubspotContact.properties?.company?.value) {
      propertiesToUpdate.company = contactInfo.company;
    }

    // Add SalesGodCRM ID to a custom field if available
    if (sgcrmId) {
      propertiesToUpdate.salesgodcrm_contact_id = sgcrmId;
    }

    await updateHubSpotContact(contactId, propertiesToUpdate);

    // ========================================================================
    // Log and Return Success
    // ========================================================================
    const auditLog = {
      timestamp: new Date().toISOString(),
      sgcrm_id: sgcrmId,
      hubspot_contact_id: contactId,
      email: contactEmail,
      action: hubspotContact.found ? 'updated_existing' : 'created_new',
      source_system: 'SGCRM',
      properties_updated: Object.keys(propertiesToUpdate)
    };

    console.log('Sync successful:', JSON.stringify(auditLog, null, 2));

    return res.status(200).json({
      success: true,
      hubspotContactId: contactId,
      action: hubspotContact.found ? 'updated' : 'created',
      auditLog
    });

  } catch (error) {
    console.error('Webhook processing error:', error.message);

    // Return 500 to trigger retry with backoff
    return res.status(500).json({
      error: 'Webhook processing failed',
      message: error.message
    });
  }
});

// Smartlead Webhook
app.post('/webhook/smartlead', async (req, res) => {
  console.log('========================================');
  console.log('Received Smartlead webhook');
  console.log('Timestamp:', new Date().toISOString());
  console.log('Headers:', JSON.stringify(req.headers, null, 2));
  console.log('Full payload:', JSON.stringify(req.body, null, 2));
  console.log('Payload keys:', Object.keys(req.body));
  console.log('========================================');

  try {
    // Verify signature if secret is configured
    if (!verifyWebhookSignature(req)) {
      console.error('HMAC verification failed');
      return res.status(401).json({ error: 'Unauthorized: Invalid signature' });
    }

    // Parse Smartlead webhook payload
    const {
      to_email,
      to_name,
      sl_lead_email,
      campaign_name,
      campaign_id,
      event_type,
      sl_email_lead_id,
      from_email
    } = req.body;

    // Get contact email from Smartlead fields
    const contactEmail = to_email || sl_lead_email;
    
    if (!contactEmail) {
      console.error('Missing email in webhook payload');
      console.error('Available fields:', Object.keys(req.body));
      return res.status(400).json({
        error: 'Missing email in webhook payload',
        payload: req.body,
        availableFields: Object.keys(req.body)
      });
    }

    console.log(`Processing Smartlead ${event_type || 'event'} for ${contactEmail}`);

    // Prepare contact info from Smartlead data
    // Split to_name if it contains first and last name
    const nameParts = to_name ? to_name.split(' ') : [];
    const contactInfo = {
      firstName: nameParts[0] || null,
      lastName: nameParts.slice(1).join(' ') || null,
      phone: null,
      company: null
    };

    // Find or create HubSpot contact
    const hubspotContact = await getOrCreateHubSpotContact(contactEmail, contactInfo);
    const contactId = hubspotContact.contactId;

    // Build properties to update - tag as "Smartlead Email Campaign"
    const propertiesToUpdate = {
      source_system: 'Smartlead Email Campaign'
    };

    // Include additional fields from Smartlead if they differ
    if (contactInfo.firstName && !hubspotContact.properties?.firstname?.value) {
      propertiesToUpdate.firstname = contactInfo.firstName;
    }
    if (contactInfo.lastName && !hubspotContact.properties?.lastname?.value) {
      propertiesToUpdate.lastname = contactInfo.lastName;
    }
    if (contactInfo.phone && !hubspotContact.properties?.phone?.value) {
      propertiesToUpdate.phone = contactInfo.phone;
    }
    if (contactInfo.company && !hubspotContact.properties?.company?.value) {
      propertiesToUpdate.company = contactInfo.company;
    }

    // Note: Custom properties like smartlead_lead_id and smartlead_campaign
    // need to be created in HubSpot first if you want to store these values

    await updateHubSpotContact(contactId, propertiesToUpdate);

    // Log and Return Success
    const auditLog = {
      timestamp: new Date().toISOString(),
      smartlead_lead_id: sl_email_lead_id,
      smartlead_campaign: campaign_name,
      event_type: event_type,
      hubspot_contact_id: contactId,
      email: contactEmail,
      action: hubspotContact.found ? 'updated_existing' : 'created_new',
      source_system: 'Smartlead',
      properties_updated: Object.keys(propertiesToUpdate)
    };

    console.log('Sync successful:', JSON.stringify(auditLog, null, 2));

    return res.status(200).json({
      success: true,
      hubspotContactId: contactId,
      action: hubspotContact.found ? 'updated' : 'created',
      auditLog
    });

  } catch (error) {
    console.error('Webhook processing error:', error.message);

    // Return 500 to trigger retry with backoff
    return res.status(500).json({
      error: 'Webhook processing failed',
      message: error.message
    });
  }
});

// ============================================================================
// Health Check Endpoint
// ============================================================================
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    hubspotConnected: !!HUBSPOT_API_KEY
  });
});

// ============================================================================
// Server Start
// ============================================================================
app.listen(PORT, () => {
  console.log(`\n✓ SalesGodCRM ↔ HubSpot Webhook Receiver Active`);
  console.log(`✓ Listening on port ${PORT}`);
  console.log(`✓ Webhook endpoint: POST /webhook/salesgodscrm`);
  console.log(`✓ Health check: GET /health\n`);
  console.log(`⚠️  Configure SalesGodCRM webhook to: https://your-domain.com/webhook/salesgodscrm\n`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down gracefully...');
  process.exit(0);
});