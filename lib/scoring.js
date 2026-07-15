/**
 * Franchise Empire Brand Scoring Framework v2.3 — public engine.
 * Scores Sections 2 (Financial Strength & ROI) and 3 (Brand System Health & Stability).
 * Section 1 (CRM) and Section 5 (Market Position) are intentionally excluded from
 * the public tool.
 *
 * Missing-data rule: if a criterion can't be evaluated, it is excluded from BOTH
 * numerator and denominator. Never score 0 for missing data.
 * Final score = earned / available * 100, rounded.
 */

function midpoint(low, high) {
  if (isNum(low) && isNum(high)) return (low + high) / 2;
  if (isNum(low)) return low;
  if (isNum(high)) return high;
  return null;
}

function isNum(v) {
  return typeof v === "number" && isFinite(v);
}

/**
 * @param {object} d — extracted FDD data (see extract.js for shape)
 * @returns {object} { score, grade, gradeLabel, earned, available, criteria[], flags[], findings[] }
 */
function scoreBrand(d) {
  const criteria = [];
  const flags = [];

  const push = (id, label, earned, max, note, excluded = false) => {
    criteria.push({ id, label, earned, max, note, excluded });
  };

  /* ---------------- SECTION 2 — Financial Strength & ROI (29 pts) ---------------- */

  // 2A. Sales-to-Investment Ratio (16 pts) — most important criterion
  {
    const revenue = isNum(d.item19_median_revenue)
      ? d.item19_median_revenue
      : isNum(d.item19_avg_revenue)
        ? d.item19_avg_revenue
        : null;
    const invest = midpoint(d.investment_low, d.investment_high);
    if (revenue !== null && isNum(invest) && invest > 0) {
      const ratio = revenue / invest;
      const service = d.brand_type !== "brick_and_mortar";
      let pts;
      if (service) {
        pts = ratio >= 4 ? 16 : ratio >= 3 ? 13 : ratio >= 2 ? 7 : 0;
      } else {
        pts = ratio >= 3 ? 16 : ratio >= 2 ? 13 : ratio >= 1.5 ? 7 : 0;
      }
      const note = `${ratio.toFixed(1)}:1 (${service ? "service" : "brick & mortar"} thresholds; ` +
        `${isNum(d.item19_median_revenue) ? "median" : "average"} revenue vs. investment midpoint)`;
      if (pts === 0) flags.push("Sales-to-investment ratio is below the minimum for this brand type.");
      push("2A", "Sales-to-Investment Ratio", pts, 16, note);
    } else {
      push("2A", "Sales-to-Investment Ratio", 0, 16,
        "Not evaluable — revenue or investment figures unavailable.", true);
    }
  }

  // 2B. Item 19 Disclosure Quality (6 pts)
  {
    if (d.item19_exists === false) {
      flags.push("No Item 19 financial performance representation disclosed.");
      push("2B", "Item 19 Disclosure Quality", 0, 6, "No Item 19 disclosed.");
    } else if (d.item19_exists === true && isNum(d.item19_pct_reporting)) {
      const p = d.item19_pct_reporting;
      const pts = p > 75 ? 6 : p >= 50 ? 4 : p >= 25 ? 2 : 1;
      push("2B", "Item 19 Disclosure Quality", pts, 6, `${p}% of franchisees reported.`);
    } else if (d.item19_exists === true) {
      // Item 19 exists but reporting % unknown — conservative "minimal" credit
      push("2B", "Item 19 Disclosure Quality", 1, 6,
        "Item 19 disclosed, but the share of franchisees reporting could not be determined.");
    } else {
      push("2B", "Item 19 Disclosure Quality", 0, 6, "Not evaluable.", true);
    }
  }

  // 2C. YoY Revenue Trend (4 pts)
  {
    if (isNum(d.yoy_revenue_change_pct)) {
      const c = d.yoy_revenue_change_pct;
      let pts;
      if (c >= 5) pts = 4;
      else if (c >= 0) pts = 3;
      else if (c > -15) pts = 1;
      else {
        pts = 0;
        flags.push(`Average unit revenue declined ${Math.abs(c).toFixed(1)}% year over year (>15% drop).`);
      }
      push("2C", "Year-over-Year Revenue Trend", pts, 4, `${c >= 0 ? "+" : ""}${c.toFixed(1)}% YoY.`);
    } else if (d.is_first_or_second_fdd === true) {
      push("2C", "Year-over-Year Revenue Trend", 2, 4,
        "First or second FDD — insufficient comparison data (neutral credit).");
    } else {
      push("2C", "Year-over-Year Revenue Trend", 0, 4, "Not evaluable — no multi-year data.", true);
    }
  }

  // 2D. Royalty Rate (3 pts)
  {
    if (isNum(d.royalty_rate_pct)) {
      const r = d.royalty_rate_pct;
      const pts = r <= 5 ? 3 : r <= 7 ? 2 : r <= 9 ? 1 : 0;
      push("2D", "Royalty Rate", pts, 3, `${r}% of gross.`);
    } else {
      push("2D", "Royalty Rate", 0, 3, "Not evaluable — royalty not identified.", true);
    }
  }

  /* ---------------- SECTION 3 — Brand System Health & Stability (20 pts) ---------------- */

  const years = Array.isArray(d.item20_years) ? d.item20_years.filter(y => y) : [];
  const latest = years.length ? years[years.length - 1] : null;

  // 3A. Franchisee Retention Rate (8 pts)
  {
    if (latest && isNum(latest.start) && latest.start > 0 && isNum(latest.closed)) {
      if (years.length < 3) {
        push("3A", "Franchisee Retention Rate", 4, 8,
          "Fewer than 3 years of unit history — neutral credit per framework.");
      } else {
        const retention = ((latest.start - latest.closed) / latest.start) * 100;
        let pts;
        if (retention >= 90) pts = 8;
        else if (retention >= 80) pts = 5;
        else if (retention >= 70) pts = 2;
        else {
          pts = 0;
          flags.push(`Franchisee retention is ${retention.toFixed(0)}% — below the 70% floor.`);
        }
        push("3A", "Franchisee Retention Rate", pts, 8,
          `${retention.toFixed(1)}% retention in most recent year (${latest.closed} closures on ${latest.start} units).`);
      }
    } else {
      push("3A", "Franchisee Retention Rate", 0, 8, "Not evaluable — Item 20 unit history unavailable.", true);
    }
  }

  // 3B. Transfer Rate (4 pts)
  {
    if (latest && isNum(latest.transferred) && isNum(latest.start)) {
      const end = isNum(latest.end) ? latest.end : latest.start;
      const avgCount = (latest.start + end) / 2;
      if (avgCount > 0) {
        const rate = (latest.transferred / avgCount) * 100;
        let pts;
        if (rate < 5) pts = 4;
        else if (rate <= 10) pts = 2;
        else {
          pts = 0;
          flags.push(`Transfer rate is ${rate.toFixed(1)}%/yr — above 10%.`);
        }
        push("3B", "Transfer Rate", pts, 4, `${rate.toFixed(1)}% of units transferred in most recent year.`);
      } else {
        push("3B", "Transfer Rate", 0, 4, "Not evaluable.", true);
      }
    } else {
      push("3B", "Transfer Rate", 0, 4, "Not evaluable — transfer data unavailable.", true);
    }
  }

  // 3C. Brand Maturity (5 pts)
  {
    const units = isNum(d.franchised_units_current) ? d.franchised_units_current : null;
    const yearsFranchising = isNum(d.year_franchising_began)
      ? new Date().getFullYear() - d.year_franchising_began
      : null;
    if (units !== null || yearsFranchising !== null) {
      const u = units ?? 0;
      const y = yearsFranchising ?? 0;
      let pts, tier;
      if (u < 15 || (yearsFranchising !== null && y < 3)) {
        pts = 0; tier = "Unproven (<15 units or <3 years)";
        flags.push("Brand is unproven — under 15 units or franchising fewer than 3 years.");
      } else if (u >= 100 && y >= 15) {
        pts = 5; tier = "Bluechip (100+ units, 15+ years)";
      } else if (u >= 50 || y >= 7) {
        pts = 4; tier = "Established (50–99 units or 7+ years)";
      } else {
        pts = 3; tier = "Emerging (15–49 units, 3–6 years)";
      }
      push("3C", "Brand Maturity", pts, 5,
        `${tier} — ${units ?? "?"} franchised units, franchising ${yearsFranchising ?? "?"} years.`);
    } else {
      push("3C", "Brand Maturity", 0, 5, "Not evaluable.", true);
    }
  }

  // 3D. Corporate/Company-Owned Units (3 pts)
  {
    if (isNum(d.company_owned_units)) {
      const c = d.company_owned_units;
      let pts;
      if (c >= 3) pts = 3;
      else if (c >= 1) pts = 2;
      else pts = d.had_company_owned_previously === true ? 1 : 0;
      push("3D", "Company-Owned Units", pts, 3, `${c} company-owned unit(s).`);
    } else {
      push("3D", "Company-Owned Units", 0, 3, "Not evaluable.", true);
    }
  }

  /* ---------------- Normalize ---------------- */

  const scored = criteria.filter(c => !c.excluded);
  const earned = scored.reduce((s, c) => s + c.earned, 0);
  const available = scored.reduce((s, c) => s + c.max, 0);
  const score = available > 0 ? Math.round((earned / available) * 100) : null;

  let grade = null, gradeLabel = null;
  if (score !== null) {
    if (score >= 80) { grade = "A"; gradeLabel = "Exceptional"; }
    else if (score >= 65) { grade = "B"; gradeLabel = "Strong"; }
    else if (score >= 50) { grade = "C"; gradeLabel = "Proceed with caution"; }
    else if (score >= 35) { grade = "D"; gradeLabel = "Serious concerns"; }
    else { grade = "F"; gradeLabel = "High risk"; }
  }

  /* ---------------- Public findings (teaser) ---------------- */
  // Strengths = criteria scoring >= 75% of max, ordered by weight; then flags.
  const findings = [];
  const byWeight = [...scored].sort((a, b) => b.max - a.max);
  for (const c of byWeight) {
    if (c.max > 0 && c.earned / c.max >= 0.75) {
      findings.push({ type: "strength", text: `${c.label}: ${c.note}` });
    }
  }
  for (const f of flags) findings.push({ type: "flag", text: f });

  return { score, grade, gradeLabel, earned, available, criteria, flags, findings };
}

module.exports = { scoreBrand };
