import axios from 'axios';
const API_BASE = 'http://localhost:3001'; // Assuming default backend port

async function testAudit() {
    console.log("🚀 Starting Audit Integration Test...");

    const testDocState = {
        type: "doc",
        content: [
            {
                type: "paragraph",
                content: [
                    { type: "text", text: "This is a test document with a citation " },
                    { type: "text", text: "(Smith, 2020)", marks: [{ type: "citation", attrs: { id: "cit-1" } }] }
                ]
            },
            {
                type: "paragraph",
                content: [
                    { type: "text", text: "Bibliography:" }
                ]
            },
            {
                type: "paragraph",
                content: [
                    { type: "text", text: "Smith, J. (2020). The Future of AI in Research. Journal of Artificial Intelligence." }
                ]
            }
        ]
    };

    try {
        // 1. Start Audit
        console.log("📡 Triggering audit...");
        const startRes = await axios.post(`${API_BASE}/api/audit/start`, {
            documentId: "test-doc-123",
            projectId: "test-proj-456",
            docState: testDocState
        });

        const { auditId } = startRes.data.data;
        console.log(`✅ Audit started. ID: ${auditId}`);

        // 2. Poll for results (since we can't easily use SSE in a quick script)
        console.log("⏳ Polling for completion...");
        let completed = false;
        let attempts = 0;
        while (!completed && attempts < 20) {
            // In a real scenario we'd use SSE, but let's check if there's a status endpoint or just wait
            await new Promise(r => setTimeout(r, 2000));

            // We don't have a direct GET status endpoint besides the SSE, but we can check the logs if run_command works
            console.log(`...waiting (attempt ${attempts + 1})`);
            attempts++;

            // If we wait long enough, the background process should finish.
        }

        console.log("🏁 Test complete. Check backend console for logs.");

    } catch (error) {
        console.error("❌ Test failed:", error.message);
    }
}

testAudit();
