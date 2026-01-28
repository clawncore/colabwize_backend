/**
 * Test script to verify webhook handler works with real payload
 * Run with: npx ts-node src/tests/test-webhook.ts
 */

import crypto from "crypto";

const WEBHOOK_URL = "http://localhost:10000/api/webhooks/lemonsqueezy";
const WEBHOOK_SECRET = process.env.LEMONSQUEEZY_WEBHOOK_SECRET || "test-secret";

// Real webhook payload from user
const webhookPayload = {
    "data": {
        "id": "1830926",
        "type": "subscriptions",
        "attributes": {
            "status": "active",
            "ends_at": null,
            "order_id": 7419281,
            "store_id": 245634,
            "cancelled": false,
            "renews_at": "2026-02-28T09:02:52.000000Z",
            "test_mode": true,
            "user_name": "THE EAGLE",
            "created_at": "2026-01-28T09:02:54.000000Z",
            "updated_at": "2026-01-28T09:03:00.000000Z",
            "user_email": "eaglixar@gmail.com",
            "variant_id": 1192024,
            "customer_id": 7679695,
            "product_name": "ColabWize Researcher",
            "variant_name": "Researcher Monthly"
        }
    },
    "meta": {
        "test_mode": true,
        "event_name": "subscription_updated",
        "webhook_id": "de5577d5-93c3-407c-bead-e36e910cd38a",
        "custom_data": {
            "plan": "researcher",
            "user_id": "f8292a05-3cbf-4a49-89c1-368b0d273f77",
            "billingPeriod": "yearly"
        }
    }
};

async function testWebhook() {
    const payload = JSON.stringify(webhookPayload);

    // Generate signature
    const signature = crypto
        .createHmac("sha256", WEBHOOK_SECRET)
        .update(payload)
        .digest("hex");

    console.log("🧪 Testing webhook with real payload...\n");
    console.log("Event:", webhookPayload.meta.event_name);
    console.log("User ID:", webhookPayload.meta.custom_data.user_id);
    console.log("Plan:", webhookPayload.meta.custom_data.plan);
    console.log("\nSending request to:", WEBHOOK_URL);
    console.log("Signature:", signature.substring(0, 20) + "...\n");

    try {
        const response = await fetch(WEBHOOK_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Signature": signature,
            },
            body: payload,
        });

        const result = await response.json();

        console.log("✅ Response Status:", response.status);
        console.log("✅ Response Body:", JSON.stringify(result, null, 2));

        if (response.ok) {
            console.log("\n✅ Webhook processed successfully!");
        } else {
            console.log("\n❌ Webhook failed!");
        }
    } catch (error: any) {
        console.error("\n❌ Error:", error.message);
    }
}

testWebhook();
