// Metrics glossary exposed as an MCP resource so the LLM has grounding for
// domain terminology without prompt-stuffing every tool description.

export const GLOSSARY_URI = "cohort-lens://glossary/metrics";
export const GLOSSARY_MIME = "text/markdown";

export const GLOSSARY_TEXT = `# cohort-lens metrics glossary

## Cohort
A "cohort" is the set of users who installed on the SAME day, via the SAME
campaign, in the SAME country. All metrics in this system are cohort-based,
not calendar-based.

## day_index
Days-since-install for a cohort. day_index=0 is install day; day_index=30 is
the 30th day after install. Ranges 0..90.

## cohort_date
The acquisition date (UTC). Do not confuse with day_index — cohort_date is
"when did users start" and day_index is "how long since they started".

## ROAS (Return On Ad Spend)
revenue / spend, in USD. Computed on cohort revenue THROUGH the requested
horizon (default dayIndex=30). ROAS=1.0 means "we've earned back what we
spent". ROAS is a measured value — the numbers we already have.

## pROAS (predicted ROAS)
Model output: what ROAS is expected to be at the horizon. Different from ROAS
because it can look further ahead than we have data for. Always present as a
PREDICTION, never as a measured value. If pROAS >> ROAS the model is
projecting continued revenue growth; the further the horizon, the more
uncertainty.

## CPI (Cost Per Install)
spend / installs, in USD. Lower is better. Meaningless when installs is 0.

## Retention proxy (D7 / D0 revenue ratio)
The creative-score uses this as a weak retention signal. D0 revenue is
usually tiny or zero (users just installed), so the ratio is inherently
noisy — it's included as a *contributing* signal, not a decisive one.

## significance="low_volume"
compare_periods flags rows where either period has fewer than 100 installs.
A big % delta on a low_volume row is noise, not a trend. Prefer to say
"not enough data" rather than presenting a misleading percentage.

## Currency
All money in responses is USD. Sources are stored in the original currency
and converted using fx_rates for the cohort date exactly once, on the DB
side. There is no need to convert further.

## Timezone
All bucketing happens in the org's reporting_timezone (returned in each
response's meta.timezone). DST boundaries are handled correctly — a
spring-forward day is 23h long and is reflected as such in date filters.
`;
