# Contact Data Cloud Field Mapping - authoring notes

## Diagram type: `datamapping`

The request is a Data Cloud / Data 360 pipeline: a Salesforce **source** object ingested into a
**Data Lake Object**, then mapped **field by field** into a harmonized **Data Model Object**
(Individual). That is exactly the question `datamapping` answers ("How does data flow from source to
target, field by field?"), and it is Data-Cloud-specific (its layers are Source / DLO / DMO). A plain
`datamodel` ERD would show the objects and their relationships but not the field-level lineage the
user asked to "visualize". So `datamapping` - which turns on mapping mode (all-field ports, the
`category` badge, auto-styled mapping links) - is the correct pick.

## How it was built (per the spec's Data Cloud section)

- **Three layer Zones** (`sf.Zone` + `layerStage`), laid out as left -> right columns:
  `source` (blue) -> `dlo` (amber) -> `dmo` (red). Each DataObject is embedded in its Zone on BOTH
  sides (object `parent` = zone id AND zone `embeds` lists the object) so it reports the right Data Layer.
- **Objects** (`sf.DataObject`): `Salesforce Contact` (Source, native types, no `category`) ->
  `Contact` DLO -> `Individual` DMO. Both DLO and DMO set the platform-enforced `category: "Profile"`
  (identity/master entities). Field types are **normalized** to Data Cloud primitives on the DLO/DMO
  (`varchar(255)`/`Id` -> `Text`), which is the documented way to show the ingestion transformation.
  Primary keys on the DLO/DMO are `fqk` (Fully Qualified Key - source-qualified); the source PK is `pk`.
  `showLabels: true` renders the API name next to the label so the name evolution (e.g.
  `FirstName` -> `FirstName__c` -> `First Name (FirstName)`) is visible - the Data Cloud norm.
- **10 field-level mapping links** (`linkKind: "mapping"`, amber `#F6B355`, `strokeWidth 1`,
  `mappingType: "Standard"`): 5 Source->DLO and 5 DLO->DMO, one per field (Id, First/Last Name, Email,
  Phone), wired to the generated field ports (`field-right-<fid>` -> `field-left-<fid>`). All are
  Standard (direct copies - the user described no transform logic).
- **2 object-level ER overlay links** (grey, header `er-right`->`er-left`, crow's-foot, `sfManhattan`):
  Contact->DLO and DLO->Individual, so the diagram reads at two levels (table relationships at a glance,
  field lineage in detail) - the spec's "pair overlay" composition rule.
- **Connectivity audited**: every Source field maps out, every DLO field has an in+out link, and the
  DMO key is mapped. No unconnected objects or fields.

Note on the DMO fields: I used the exact field list the user gave for the Individual DMO
(Id, First Name, Last Name, Email Address, Phone Number). In a real standard Data 360 model, email/phone
live on the Contact Point Email / Contact Point Phone DMOs rather than on Individual, but the diagram
faithfully reflects the mapping the user described.

## Validator output (verbatim)

```
$ node diagramforce/scripts/validate-diagram.mjs diagram.json
✓ /Users/md/Documents/Code/vibe/diagramforce-dev/cowork-skill/diagramforce-workspace/iteration-1/eval-datacloud/with_skill/outputs/diagram.json: valid

✓ 1 file(s) checked - 0 error(s), 0 warning(s).
```

Exit code 0 - passes with 0 errors and 0 warnings.

## How to open the diagram

1. Open **https://diagramforce.mateuszdabrowski.pl**
2. Click **Load & Import**.
3. Choose the **File** tab and open `diagram.json`, OR choose the **Paste** tab, paste the JSON
   contents, and click **Load**.
4. The mapping opens as a new tab. No sign-in, no backend - nothing leaves your browser.
   (Optional: run **Auto Layout** to re-tidy the columns.)
