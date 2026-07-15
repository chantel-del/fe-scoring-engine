/**
 * Sends FDD text excerpts (Items 6, 7, 19, 20) to Claude and returns
 * structured data for the scoring engine. Uses the Anthropic Messages API
 * directly via fetch — no SDK dependency.
 */

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";
const MAX_CHARS_PER_ITEM = 60000;

const EXTRACTION_TOOL = {
  name: "record_fdd_data",
  description: "Record the structured data extracted from the FDD.",
  input_schema: {
    type: "object",
    properties: {
      brand_name: { type: ["string", "null"] },
      brand_type: {
        type: "string",
        enum: ["service", "brick_and_mortar"],
        description:
          "service = home-based/mobile/service businesses (cleaning, restoration, senior care, staffing, etc.). brick_and_mortar = retail storefront, food, fitness studios, any business requiring dedicated customer-facing premises."
      },
      royalty_rate_pct: { type: ["number", "null"], description: "Ongoing royalty as % of gross sales (Item 6). If a range, use the typical/midpoint value. If flat fee only, null." },
      marketing_fund_pct: { type: ["number", "null"] },
      franchise_fee: { type: ["number", "null"], description: "Initial franchise fee in USD (Item 7)." },
      investment_low: { type: ["number", "null"], description: "Low end of total initial investment range in USD (Item 7)." },
      investment_high: { type: ["number", "null"], description: "High end of total initial investment range in USD (Item 7)." },
      item19_exists: { type: ["boolean", "null"], description: "Does the FDD make a financial performance representation in Item 19?" },
      item19_pct_reporting: { type: ["number", "null"], description: "Percent (0-100) of franchised units included in the Item 19 figures. Compute from counts if stated (e.g. '120 of 160 units' = 75)." },
      item19_avg_revenue: { type: ["number", "null"], description: "Average gross revenue/sales per unit in USD, most recent year." },
      item19_median_revenue: { type: ["number", "null"], description: "Median gross revenue/sales per unit in USD, most recent year." },
      yoy_revenue_change_pct: { type: ["number", "null"], description: "Percent change in average or median unit revenue vs. prior year, if Item 19 shows multiple years. Negative = decline." },
      is_first_or_second_fdd: { type: ["boolean", "null"], description: "True if this appears to be the franchisor's first or second FDD (very new system)." },
      item20_years: {
        type: "array",
        description: "Franchised-unit activity from Item 20 tables, oldest year first, up to 3 most recent years.",
        items: {
          type: "object",
          properties: {
            year: { type: "number" },
            start: { type: ["number", "null"], description: "Franchised outlets at start of year." },
            end: { type: ["number", "null"], description: "Franchised outlets at end of year." },
            opened: { type: ["number", "null"] },
            closed: { type: ["number", "null"], description: "Terminations + non-renewals + ceased operations (NOT transfers)." },
            transferred: { type: ["number", "null"] }
          },
          required: ["year"]
        }
      },
      franchised_units_current: { type: ["number", "null"], description: "Total franchised outlets at most recent year end." },
      company_owned_units: { type: ["number", "null"], description: "Company-owned outlets at most recent year end." },
      had_company_owned_previously: { type: ["boolean", "null"] },
      year_franchising_began: { type: ["number", "null"], description: "Year the company began franchising (Item 1/20)." }
    },
    required: ["brand_type"]
  }
};

function clip(text) {
  if (!text) return "(not found in document)";
  return text.length > MAX_CHARS_PER_ITEM ? text.slice(0, MAX_CHARS_PER_ITEM) + "\n[...truncated]" : text;
}

async function extractFddData({ item6, item7, item19, item20, fullTextFallback }) {
  let userContent;
  if (item6 || item7 || item19 || item20) {
    userContent =
      `Extract the required data from these FDD excerpts.\n\n` +
      `=== ITEM 6 (FEES) ===\n${clip(item6)}\n\n` +
      `=== ITEM 7 (INITIAL INVESTMENT) ===\n${clip(item7)}\n\n` +
      `=== ITEM 19 (FINANCIAL PERFORMANCE) ===\n${clip(item19)}\n\n` +
      `=== ITEM 20 (OUTLET INFORMATION) ===\n${clip(item20)}`;
  } else {
    userContent =
      `The item sections could not be isolated. Extract the required data from this FDD text:\n\n` +
      (fullTextFallback || "").slice(0, 350000);
  }

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2000,
      system:
        "You are a meticulous franchise analyst extracting data from Franchise Disclosure Documents. " +
        "Use ONLY what the document states — never guess or fill in typical values. " +
        "If a value is not clearly stated or derivable, return null for it. " +
        "All dollar figures in USD as plain numbers. Percentages as numbers 0-100. " +
        "For Item 20, use the FRANCHISED outlet tables (not company-owned) and count " +
        "closures as terminations + non-renewals + ceased operations, excluding transfers. " +
        "Always call the record_fdd_data tool.",
      tools: [EXTRACTION_TOOL],
      tool_choice: { type: "tool", name: "record_fdd_data" },
      messages: [{ role: "user", content: userContent }]
    })
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Anthropic API error ${res.status}: ${body.slice(0, 300)}`);
  }

  const data = await res.json();
  const toolUse = (data.content || []).find(b => b.type === "tool_use");
  if (!toolUse) throw new Error("No structured extraction returned by model.");
  return toolUse.input;
}

module.exports = { extractFddData };
