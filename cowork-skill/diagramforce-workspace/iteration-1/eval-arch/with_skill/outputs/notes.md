# Diagram notes

## Diagram type chosen: `architecture`

The request asks "how do these systems connect?" - it describes a system landscape
where data flows across independent platforms (marketing website form -> Salesforce
Sales Cloud -> Marketing Cloud Engagement via Marketing Cloud Connect -> Snowflake ->
BI dashboards). That is the defining question the `architecture` type answers
("What systems / products / integrations exist and how do they connect?").

Why not the near-neighbours:
- Not `datamapping`: that type is Data Cloud-specific (Source / DLO / DMO / Activation
  layers). A Salesforce -> Snowflake replication is a general system integration, not a
  Data Cloud field mapping.
- Not `sequence` or `process`: the message is the standing system topology and the
  integration cadence, not an ordered set of steps or a time-ordered message exchange.

## How it is laid out

Left-to-right flow: Contact Form -> Salesforce Platform (Sales Cloud + Marketing Cloud
Engagement grouped in one Container) -> Snowflake -> BI Dashboards.

- Connectors carry Architecture **Frequency** labels: "Real-time" (form -> Sales Cloud),
  "Scheduled" (MC Connect qualified-lead sync), "Nightly" (both replication hops).
- "Replicate everything nightly" is shown as two nightly connectors into Snowflake -
  All CRM records (Sales Cloud) and Engagement data (Marketing Cloud) - so "everything"
  is explicit.
- External systems (the website Contact Form and Snowflake) get an amber border; a
  `df.Legend` Key explains the amber-vs-blue classification.
- Node icons use the app's data-icon-id references (page, custom-sales, custom-marketing,
  custom-snowflake, custom-tableau, custom-platform); the app resolves them on load.

## Validator output (verbatim)

```
✓ /Users/md/Documents/Code/vibe/diagramforce-dev/cowork-skill/diagramforce-workspace/iteration-1/eval-arch/with_skill/outputs/diagram.json: valid

✓ 1 file(s) checked - 0 error(s), 0 warning(s).
```

Command run:

```
node /Users/md/Documents/Code/vibe/diagramforce-dev/cowork-skill/diagramforce/scripts/validate-diagram.mjs \
  /Users/md/Documents/Code/vibe/diagramforce-dev/cowork-skill/diagramforce-workspace/iteration-1/eval-arch/with_skill/outputs/diagram.json
```

## How to open the diagram

1. Open **https://diagramforce.mateuszdabrowski.pl**
2. Click **Load & Import**, choose the **Paste** tab, paste the contents of
   `diagram.json`, and click **Load**.
   (Or use the **File** tab and open the saved `diagram.json` directly - the same
   content also works if you rename it to `.dgf`.)
3. The diagram opens as a new tab. No sign-in, no backend - nothing leaves your browser.
