import express, { Request, Response } from "express";
import { ForensicAuditService } from "../../services/citationAudit/ForensicAuditService";

const router = express.Router();

router.post("/forensic-audit", async (req: Request, res: Response) => {
    console.log("\n\n🚀🚀🚀 TIER 2 FORENSIC AUDIT ENDPOINT CALLED! 🚀🚀🚀\n");

    try {
        // 1. Authentication Check (simplified)
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return res.status(401).json({ error: "Missing or invalid authorization header" });
        }

        const { getSupabaseClient } = await import("../../lib/supabase/client");
        const token = authHeader.substring(7);
        let userId: string;

        try {
            const client = await getSupabaseClient();
            if (!client) throw new Error("Supabase client missing");
            const { data: { user }, error } = await client.auth.getUser(token);
            if (error || !user) throw new Error("Invalid token");
            userId = user.id;
        } catch (e) {
            return res.status(401).json({ error: "Invalid or expired token" });
        }

        const { pairs } = req.body;

        if (!pairs || !Array.isArray(pairs)) {
            return res.status(400).json({ error: "Invalid request: missing pairs array." });
        }

        console.log(`📋 Forensic Audit Request for ${pairs.length} citation pairs.`);

        const flags: any[] = [];
        let verificationResults: any[] = [];

        // 2. Perform Forensic Audit
        if (pairs.length > 0) {
            const forensicResults = await ForensicAuditService.auditCitations(pairs);

            // Map forensic results back to flags and verificationResults for frontend compatibility
            forensicResults.forEach(fRes => {
                if (fRes.status !== "VERIFIED") {
                    flags.push({
                        type: "VERIFICATION", // General bucket
                        ruleId: `FORENSIC_${fRes.status}`,
                        message: fRes.issues[0] || "Citation issue detected.",
                        tier: "CLAIM",
                        anchor: {
                            start: fRes.pair.inline.start,
                            end: fRes.pair.inline.end,
                            text: fRes.pair.inline.text
                        },
                        reason: fRes.issues.join(" "),
                        action: "Review the evidence card."
                    });
                }

                // Keep verificationResults populated for UI
                if (fRes.evidence) verificationResults.push(fRes.evidence);
            });
        }

        res.status(200).json({
            flags,
            verificationResults
        });

    } catch (error) {
        console.error("Forensic Audit Backend Error:", error);
        res.status(500).json({ error: "Internal Audit Error" });
    }
});

// We keep the old endpoint signature around but make it basically a no-op 
// just in case any other frontend components are still calling it.
router.post("/audit", async (req: Request, res: Response) => {
    res.status(200).json({
        style: req.body.declaredStyle || "APA",
        flags: [],
        verificationResults: [],
        integrityIndex: 100,
        tiersExecuted: [],
        tierMetadata: {}
    });
});

export default router;
