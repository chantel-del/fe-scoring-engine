/**
 * POST /api/score
 * Body (JSON): {
 *   name: string, email: string,
 *   items: { item6, item7, item19, item20 } — text excerpts extracted client-side,
 *   fullText: string (fallback if items couldn't be isolated),
 *   meta: { filename, pages }
 * }
 * Returns: { score, grade, gradeLabel, brandName, findings[], flagsCount, criteriaCount }
 */

const { extractFddData } = require("../lib/extract");
const { scoreBrand } = require("../lib/scoring");
const { upsertContact } = require("../lib/hubspot");

module.exports = async function handler(req, res) {
  // CORS — restrict to your domain in production via ALLOWED_ORIGIN
  const origin = process.env.ALLOWED_ORIGIN || "*";
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { name, email, items = {}, fullText = "", meta = {} } = req.body || {};

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "A valid email address is required." });
    }
    if (!name || name.trim().length < 2) {
      return res.status(400).json({ error: "Name is required." });
    }
    const hasText =
      (items.item6 || items.item7 || items.item19 || items.item20 || fullText || "").length > 500;
    if (!hasText) {
      return res.status(400).json({
        error:
          "We couldn't read enough text from that PDF. It may be a scanned document — please upload a digital FDD."
      });
    }

    // 1. Claude extracts structured data from the FDD excerpts
    const extracted = await extractFddData({
      item6: items.item6,
      item7: items.item7,
      item19: items.item19,
      item20: items.item20,
      fullTextFallback: fullText
    });

    // 2. Hard-coded framework v2.3 scoring (Sections 2 + 3)
    const result = scoreBrand(extracted);

    if (result.score === null) {
      return res.status(422).json({
        error:
          "This document didn't contain enough scoreable data (Items 6, 7, 19, 20). Please confirm it's a complete FDD."
      });
    }

    // 3. Push the lead + score into HubSpot (non-fatal if it fails)
    let crmOk = true;
    try {
      await upsertContact({ name, email, brandName: extracted.brand_name, result });
    } catch (e) {
      crmOk = false;
      console.error("HubSpot upsert failed:", e.message);
    }

    // 4. Return the public (teaser) payload — full breakdown stays server-side
    return res.status(200).json({
      score: result.score,
      grade: result.grade,
      gradeLabel: result.gradeLabel,
      brandName: extracted.brand_name || meta.filename || "Your brand",
      brandType: extracted.brand_type,
      findings: result.findings.slice(0, 8),
      flagsCount: result.flags.length,
      criteriaCount: result.criteria.filter(c => !c.excluded).length,
      crmOk
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      error: "Something went wrong analyzing this FDD. Please try again in a minute."
    });
  }
};

// Vercel: allow up to 60s and larger JSON bodies for big FDD text payloads
module.exports.config = {
  maxDuration: 60,
  api: { bodyParser: { sizeLimit: "4mb" } }
};
