/**
 * Upserts the lead into HubSpot with their FDD score.
 * Requires a HubSpot Private App token (env HUBSPOT_TOKEN) with scopes:
 *   crm.objects.contacts.read, crm.objects.contacts.write
 */

const HS = "https://api.hubapi.com";

function headers() {
  return {
    "content-type": "application/json",
    authorization: `Bearer ${process.env.HUBSPOT_TOKEN}`
  };
}

async function upsertContact({ name, email, brandName, result }) {
  const [firstname, ...rest] = (name || "").trim().split(/\s+/);
  const properties = {
    email,
    firstname: firstname || "",
    lastname: rest.join(" ") || "",
    fdd_score: result.score != null ? String(result.score) : "",
    fdd_grade: result.grade || "",
    fdd_brand_name: brandName || "",
    fdd_flags: (result.flags || []).length
      ? result.flags.join(" | ")
      : "No red flags — this brand cleared every criterion we could score.",
    fdd_report_summary: (result.criteria || [])
      .map(c => `${c.id} ${c.label}: ${c.excluded ? "excluded (no data)" : `${c.earned}/${c.max}`} — ${c.note}`)
      .join("\n"),
    fdd_scored_at: new Date().toISOString().slice(0, 10)
  };

  // Try create; on conflict (existing contact), update by email.
  const createRes = await fetch(`${HS}/crm/v3/objects/contacts`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ properties })
  });

  if (createRes.ok) return await createRes.json();

  if (createRes.status === 409) {
    const updateRes = await fetch(
      `${HS}/crm/v3/objects/contacts/${encodeURIComponent(email)}?idProperty=email`,
      { method: "PATCH", headers: headers(), body: JSON.stringify({ properties }) }
    );
    if (updateRes.ok) return await updateRes.json();
    throw new Error(`HubSpot update failed: ${updateRes.status} ${await updateRes.text()}`);
  }

  throw new Error(`HubSpot create failed: ${createRes.status} ${await createRes.text()}`);
}

module.exports = { upsertContact };
