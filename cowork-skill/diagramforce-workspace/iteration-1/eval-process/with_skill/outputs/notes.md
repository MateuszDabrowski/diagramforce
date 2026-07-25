# Expense Approval Process - authoring notes

## Diagram type chosen: `process` (BPMN)

**Why `process`:** The request describes a step-by-step business process with an
ordered sequence and branching decisions (submit -> manager review -> a "under
$500?" decision -> Finance approve/reject -> notify). Per the spec's "Choosing
the right diagram type" section, "What are the steps of a process, in what order?
(approval, onboarding, branching)" maps to `process`.

**Why not the near-miss types:**
- Not `flow` - `flow` is only for documenting an *actual Salesforce Flow* with its
  real element vocabulary (Screen, Decision, Get/Create Records, etc.). This is a
  generic business approval process, so BPMN `process` is correct (the spec calls
  out exactly this mis-pick).
- Not `architecture` - that is for systems/integrations, never for ordered steps.
- Not `sequence` - there is no "who messages whom over time" between participants;
  it is a single-lane ordered flow with decisions.

## Shapes used
- `sf.BpmnEvent` (start "Expense submitted", end "Employee notified")
- `sf.BpmnTask` (submit / manager review / auto-approve / Finance review / notify)
- `sf.BpmnGateway` exclusive (`×`) for "Under $500?" and "Finance decision?"
- `sf.TextLabel` header line
- `standard.Link` connectors (arrows auto-added by the loader; `targetMarker`
  intentionally omitted). Branch outcomes carried as link labels
  (Yes/No, Auto-approved, Approved, Rejected).

Layout is left-to-right: the main lane runs across the middle, the auto-approve
(under $500) branch goes up, the Finance branch goes down, and all three outcomes
converge on the single "Notify employee of outcome" task before the end event
(each entering on a distinct port so no connectors overlap).

## Validator output (verbatim)

```
$ node /Users/md/Documents/Code/vibe/diagramforce-dev/cowork-skill/diagramforce/scripts/validate-diagram.mjs .../outputs/diagram.json
✓ /Users/md/Documents/Code/vibe/diagramforce-dev/cowork-skill/diagramforce-workspace/iteration-1/eval-process/with_skill/outputs/diagram.json: valid

✓ 1 file(s) checked - 0 error(s), 0 warning(s).
```

## How to open the diagram

1. Open **https://diagramforce.mateuszdabrowski.pl**
2. Click **Load & Import**, choose the **Paste** tab, paste the contents of
   `diagram.json`, and click **Load**.
   (Or use the **File** tab and select the saved `diagram.json`.)
3. The diagram opens as a new tab. No sign-in, nothing leaves your browser.
