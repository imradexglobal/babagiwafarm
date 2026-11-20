$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem

$SourcePath = 'C:\Users\USER\Desktop\FARM APP PROCESS DOCUMENTATION.xlsx'
$SpecsPath = 'C:\Users\USER\Documents\Imradex_Project\babagiwafarm\.work\process_specs.json'
$OutputPath = 'C:\Users\USER\Desktop\FARM APP PROCESS DOCUMENTATION V2.xlsx'
if (-not (Test-Path -LiteralPath $SourcePath)) { throw "Source workbook is missing: $SourcePath" }
if (-not (Test-Path -LiteralPath $SpecsPath)) { throw "Process specification data is missing: $SpecsPath" }
if (Test-Path -LiteralPath $OutputPath) { throw "Output already exists; refusing to overwrite: $OutputPath" }
$specs = ConvertFrom-Json -InputObject (Get-Content -LiteralPath $SpecsPath -Raw -Encoding UTF8)
if ($specs.Count -ne 20) { throw "Expected 20 process specifications; found $($specs.Count)." }
$tabNames = @($specs | ForEach-Object { $_.tab_name })
if (($tabNames | Select-Object -Unique).Count -ne 20) { throw 'Process sheet names are not unique.' }

$mainNs = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
$relsNs = 'http://schemas.openxmlformats.org/package/2006/relationships'
$docRelNs = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
$ctNs = 'http://schemas.openxmlformats.org/package/2006/content-types'
$epNs = 'http://schemas.openxmlformats.org/officeDocument/2006/extended-properties'
$vtNs = 'http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes'

function Read-ZipText($zip, [string]$name) {
  $entry = $zip.GetEntry($name)
  if (-not $entry) { throw "Missing XLSX package part: $name" }
  $reader = [IO.StreamReader]::new($entry.Open(), [Text.Encoding]::UTF8, $true)
  try { return $reader.ReadToEnd() } finally { $reader.Dispose() }
}
function Read-ZipXml($zip, [string]$name) {
  $doc = [Xml.XmlDocument]::new()
  $doc.PreserveWhitespace = $false
  $doc.LoadXml((Read-ZipText $zip $name))
  return $doc
}
function Xml-Bytes([Xml.XmlDocument]$doc) {
  $settings = [Xml.XmlWriterSettings]::new()
  $settings.Encoding = [Text.UTF8Encoding]::new($false)
  $settings.Indent = $false
  $settings.OmitXmlDeclaration = $false
  $ms = [IO.MemoryStream]::new()
  $writer = [Xml.XmlWriter]::Create($ms, $settings)
  try { $doc.Save($writer); $writer.Flush(); return ,$ms.ToArray() } finally { $writer.Dispose(); $ms.Dispose() }
}
function Esc([string]$value) { return [System.Security.SecurityElement]::Escape([string]$value) }
function CellXml([string]$ref, [string]$value, [int]$style) {
  $v = Esc $value
  $preserve = ''
  if ($value -match '^\s|\s$|\s{2,}|[\r\n]') { $preserve = ' xml:space="preserve"' }
  return "<c r=`"$ref`" s=`"$style`" t=`"inlineStr`"><is><t$preserve>$v</t></is></c>"
}
function RowHeight($row) {
  $longest = [Math]::Max(([string]$row.activity).Length / 43.0, [Math]::Max(([string]$row.data).Length / 52.0, ([string]$row.comment).Length / 58.0))
  $lines = [Math]::Max(3, [Math]::Ceiling($longest))
  return [Math]::Min(240, [Math]::Max(54, ($lines * 15) + 7))
}
function New-ProcessSheetXml([string]$title, [object[]]$rows, [string[]]$headers) {
  $sb = [Text.StringBuilder]::new()
  [void]$sb.Append('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>')
  [void]$sb.Append('<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A2:E')
  [void]$sb.Append([string]($rows.Count + 3))
  [void]$sb.Append('"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="3" topLeftCell="A4" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A4" sqref="A4"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/><cols><col min="1" max="1" width="16" customWidth="1"/><col min="2" max="2" width="27" customWidth="1"/><col min="3" max="3" width="43" customWidth="1"/><col min="4" max="4" width="56" customWidth="1"/><col min="5" max="5" width="63" customWidth="1"/></cols><sheetData>')
  [void]$sb.Append('<row r="2" ht="27" customHeight="1">')
  [void]$sb.Append((CellXml 'A2' $title 20))
  [void]$sb.Append('</row><row r="3" ht="24" customHeight="1">')
  for ($i = 0; $i -lt 5; $i++) {
    $col = @('A','B','C','D','E')[$i]
    $style = if ($i -eq 0) { 21 } else { 20 }
    [void]$sb.Append((CellXml ($col + '3') $headers[$i] $style))
  }
  [void]$sb.Append('</row>')
  for ($i = 0; $i -lt $rows.Count; $i++) {
    $r = $i + 4
    $data = $rows[$i]
    $height = RowHeight $data
    [void]$sb.Append("<row r=`"$r`" ht=`"$height`" customHeight=`"1`">")
    [void]$sb.Append((CellXml ("A$r") ([string]$data.id) 22))
    [void]$sb.Append((CellXml ("B$r") ([string]$data.actor) 24))
    [void]$sb.Append((CellXml ("C$r") ([string]$data.activity) 23))
    [void]$sb.Append((CellXml ("D$r") ([string]$data.data) 23))
    [void]$sb.Append((CellXml ("E$r") ([string]$data.comment) 23))
    [void]$sb.Append('</row>')
  }
  [void]$sb.Append('</sheetData><autoFilter ref="A3:E')
  [void]$sb.Append([string]($rows.Count + 3))
  [void]$sb.Append('"/><pageMargins left="0.35" right="0.35" top="0.5" bottom="0.5" header="0.2" footer="0.2"/></worksheet>')
  return $sb.ToString()
}
function Add-InlineCell([Xml.XmlDocument]$doc, [int]$rowNumber, [string]$ref, [string]$value, [int]$style) {
  $ns = [Xml.XmlNamespaceManager]::new($doc.NameTable)
  $ns.AddNamespace('m', $mainNs)
  $row = $doc.SelectSingleNode("//m:sheetData/m:row[@r='$rowNumber']", $ns)
  if (-not $row) { throw "Menu row $rowNumber not found." }
  $cell = $doc.CreateElement('c', $mainNs)
  $cell.SetAttribute('r', $ref); $cell.SetAttribute('s', [string]$style); $cell.SetAttribute('t', 'inlineStr')
  $is = $doc.CreateElement('is', $mainNs); $t = $doc.CreateElement('t', $mainNs)
  $t.SetAttribute('space', 'http://www.w3.org/XML/1998/namespace', 'preserve')
  $t.InnerText = $value; [void]$is.AppendChild($t); [void]$cell.AppendChild($is); [void]$row.AppendChild($cell)
}
function Add-ZipBytes($archive, [string]$name, [byte[]]$bytes) {
  $entry = $archive.CreateEntry($name, [IO.Compression.CompressionLevel]::Optimal)
  $stream = $entry.Open()
  try { $stream.Write($bytes, 0, $bytes.Length) } finally { $stream.Dispose() }
}

$notes = @(
  [pscustomobject]@{id='N-01';actor='Source-sheet naming';activity='The source workbook tab is named Sheet1, although its contents are the Process Menu.';data='V2 renames Sheet1 to Process Menu; the L1 sample is retained.';comment='The blank Sheet3 is repurposed as Developer Notes. The source workbook on the Desktop remains unchanged.'},
  [pscustomobject]@{id='N-02';actor='Duplicate process codes';activity='The menu assigns B1, B2 and B3 to both Brooder and Inventory - Birds.';data='Tabs are disambiguated as B1 - Brooder/Birds, B2 - Brooder/Birds and B3 - Brooder/Birds.';comment='Do not implement code alone as a unique key. The app owner should assign canonical unique codes or use a composite key such as module + process_code before API/database implementation.'},
  [pscustomobject]@{id='N-03';actor='Duplicate Sales row';activity='The menu repeats S2 Daily Sales Record twice.';data='One S2 specification tab is provided.';comment='The exact duplicate row is de-duplicated in V2; confirm that a second sales process was not intended.'},
  [pscustomobject]@{id='N-04';actor='L1 identifier';activity='The sample IDs appear as LI-01, LI-02 and LI-03 using the letter I.';data='New process IDs follow the relevant process code plus sequence, with short suffixes for duplicate-code tabs.';comment='Confirm whether L1 IDs should be L1-01 or remain LI-01 before migrating the sample into the app.'},
  [pscustomobject]@{id='N-05';actor='Data localization';activity='Use Nigerian farm operating conventions consistently.';data='Display dates DD/MM/YYYY; store ISO-8601; use Africa/Lagos; display NGN/Naira and store money safely in kobo; use kg, g, L, birds, eggs and configurable eggs-per-crate.';comment='Use Nigerian State/LGA and +234 phone fields where location or contact data is collected. Keep crate capacity configurable by farm.'},
  [pscustomobject]@{id='N-06';actor='Biosecurity and traceability';activity='Capture flock/lot identity and farm-relevant health and movement records.';data='Vaccination/treatment, mortality, dead-bird handling, flock transfers, vehicle/transport checks, feed lots and hygiene observations as relevant.';comment='Design controls are informed by Nigeria Federal Ministry of Livestock Development poultry value-chain biosecurity guidance: https://fmld.gov.ng/media/documents/National_Biosecurity_Guidelines_for_the_Poultry_Value_Chain.pdf . Confirm SOPs with the farm veterinarian and current authorities.'},
  [pscustomobject]@{id='N-07';actor='Veterinary product control';activity='Record product and withdrawal details when medicines are administered.';data='Product/generic identity; registration identifier where applicable; batch; manufacture/expiry dates; dose/route; administration date; label withdrawal period/end date.';comment='NAFDAC veterinary-drug labelling guidance includes batch, manufacture/expiry, product information and veterinary withdrawal period: https://www.nafdac.gov.ng/wp-content/uploads/Files/Resources/Guidelines/DR_And_R_Guidelines/Guidelines-for-Registration-of-Imported-Drug-Products-in-Nigeria-Human-and-Veterinary-Drugs.pdf . Product-specific instructions require veterinary confirmation.'},
  [pscustomobject]@{id='N-08';actor='Personal data';activity='Protect staff and customer contact information in the application.';data='Collect only fields needed for the workflow; define roles, access, retention, correction and incident procedures.';comment='NDPC is Nigeria Data Protection Authority under the Nigeria Data Protection Act 2023 and publishes data-subject rights/controller responsibilities: https://ndpc.gov.ng/ . This workbook is not a legal compliance assessment.'},
  [pscustomobject]@{id='N-09';actor='Formula and threshold ownership';activity='Keep biological thresholds and business formulas configurable.';data='Store formula version, inputs, units, numerator/denominator, rounding and approver.';comment='Farm/veterinary management should approve KPI definitions, alert thresholds, crate capacity, stock tolerances and treatment rules before production use. Never silently overwrite submitted values.'},
  [pscustomobject]@{id='N-10';actor='Workflow and audit';activity='Use controlled record statuses and immutable decision history.';data='Draft, submitted, returned, approved, rejected and posted states; user/time; reason; version; source reference; idempotency key.';comment='Post stock movements once only; route approved-record changes through audited correction or reversal rather than direct overwrite. Use role-based approval and notification settings.'},
  [pscustomobject]@{id='N-11';actor='Finance and invoices';activity='Confirm Nigerian tax and invoice requirements with farm finance before implementation.';data='NGN prices; payment method/reference; configurable tax/VAT fields; receipt or invoice numbering.';comment='Do not hard-code tax treatment, thresholds or statutory invoice wording from this process workbook; use finance-approved settings and current guidance.'},
  [pscustomobject]@{id='N-12';actor='Menu spelling';activity='The menu spells Forecast as FORCAST.';data='New E1 tab title uses Weekly Production Forecast.';comment='The source Process Menu wording is preserved except for the V2 review note; the original workbook is not changed.'}
)
$noteHeaders = @('ID','TOPIC','OBSERVATION','DEVELOPER ACTION','COMMENT / REFERENCE')
$processHeaders = @('ID','ACTOR','ACTIVITIES','DATA','COMMENT')

$sourceZip = [IO.Compression.ZipFile]::OpenRead($SourcePath)
try {
  $styleDoc = Read-ZipXml $sourceZip 'xl/styles.xml'
  $styleNs = [Xml.XmlNamespaceManager]::new($styleDoc.NameTable); $styleNs.AddNamespace('m', $mainNs)
  $xfs = $styleDoc.SelectNodes('//m:cellXfs/m:xf', $styleNs)
  if ($xfs.Count -lt 25) { throw "Source styles do not include the expected L1 template styles; found $($xfs.Count)." }

  $workbook = Read-ZipXml $sourceZip 'xl/workbook.xml'
  $wbNs = [Xml.XmlNamespaceManager]::new($workbook.NameTable); $wbNs.AddNamespace('m', $mainNs); $wbNs.AddNamespace('r', $docRelNs)
  $sheetNodes = $workbook.SelectNodes('/m:workbook/m:sheets/m:sheet', $wbNs)
  if ($sheetNodes.Count -ne 3) { throw "Expected 3 original sheets; found $($sheetNodes.Count)." }
  $sheetNodes[0].SetAttribute('name', 'Process Menu')
  $sheetNodes[2].SetAttribute('name', 'Developer Notes')
  $sheetsNode = $workbook.SelectSingleNode('/m:workbook/m:sheets', $wbNs)

  $rels = Read-ZipXml $sourceZip 'xl/_rels/workbook.xml.rels'
  $relNsMgr = [Xml.XmlNamespaceManager]::new($rels.NameTable); $relNsMgr.AddNamespace('p', $relsNs)
  $maxRid = 0
  foreach ($rel in $rels.SelectNodes('/p:Relationships/p:Relationship', $relNsMgr)) { if ($rel.Id -match '^rId(\d+)$') { $maxRid = [Math]::Max($maxRid, [int]$Matches[1]) } }
  $maxSheetId = 0; foreach ($sn in $sheetNodes) { $maxSheetId = [Math]::Max($maxSheetId, [int]$sn.GetAttribute('sheetId')) }
  $ct = Read-ZipXml $sourceZip '[Content_Types].xml'
  $ctMgr = [Xml.XmlNamespaceManager]::new($ct.NameTable); $ctMgr.AddNamespace('ct', $ctNs)
  $processParts = @()
  for ($i = 0; $i -lt $specs.Count; $i++) {
    $spec = $specs[$i]
    $sheetId = $maxSheetId + $i + 1
    $rid = $maxRid + $i + 1
    $part = "xl/worksheets/sheet$sheetId.xml"
    $relationship = $rels.CreateElement('Relationship', $relsNs)
    $relationship.SetAttribute('Id', "rId$rid")
    $relationship.SetAttribute('Type', "$docRelNs/worksheet")
    $relationship.SetAttribute('Target', "worksheets/sheet$sheetId.xml")
    [void]$rels.DocumentElement.AppendChild($relationship)
    $sheet = $workbook.CreateElement('sheet', $mainNs)
    $sheet.SetAttribute('name', [string]$spec.tab_name)
    $sheet.SetAttribute('sheetId', [string]$sheetId)
    $sheet.SetAttribute('id', $docRelNs, "rId$rid")
    [void]$sheetsNode.AppendChild($sheet)
    $override = $ct.CreateElement('Override', $ctNs)
    $override.SetAttribute('PartName', "/xl/worksheets/sheet$sheetId.xml")
    $override.SetAttribute('ContentType', 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml')
    [void]$ct.DocumentElement.AppendChild($override)
    $title = "$($spec.code) | $($spec.module) - $($spec.process_name)"
    $processParts += [pscustomobject]@{name=$part; bytes=[Text.Encoding]::UTF8.GetBytes((New-ProcessSheetXml $title @($spec.rows) $processHeaders))}
  }

  $menu = Read-ZipXml $sourceZip 'xl/worksheets/sheet1.xml'
  $menuNsMgr = [Xml.XmlNamespaceManager]::new($menu.NameTable); $menuNsMgr.AddNamespace('m', $mainNs)
  $dimension = $menu.SelectSingleNode('//m:dimension', $menuNsMgr); if ($dimension) { $dimension.SetAttribute('ref', 'A2:D29') }
  $cols = $menu.SelectSingleNode('//m:cols', $menuNsMgr)
  if ($cols) { $col = $menu.CreateElement('col', $mainNs); $col.SetAttribute('min','4'); $col.SetAttribute('max','4'); $col.SetAttribute('width','68'); $col.SetAttribute('customWidth','1'); [void]$cols.AppendChild($col) }
  Add-InlineCell $menu 2 'D2' 'V2 DATA QUALITY NOTE' 1
  Add-InlineCell $menu 19 'D19' 'Code collision: B1 is also used in the Brooder module. See Developer Notes.' 23
  Add-InlineCell $menu 20 'D20' 'Code collision: B2 is also used in the Brooder module. See Developer Notes.' 23
  Add-InlineCell $menu 21 'D21' 'Code collision: B3 is also used in the Brooder module. See Developer Notes.' 23
  Add-InlineCell $menu 24 'D24' 'Duplicate S2 row collapsed into one process specification; confirm intended design.' 23
  foreach ($r in @(19,20,21,24)) { $rowNode = $menu.SelectSingleNode("//m:sheetData/m:row[@r='$r']", $menuNsMgr); $rowNode.SetAttribute('ht','48'); $rowNode.SetAttribute('customHeight','1') }
  $menuBytes = Xml-Bytes $menu

  $notesTitle = 'Developer Implementation Notes | Nigeria-aware process specification'
  $notesBytes = [Text.Encoding]::UTF8.GetBytes((New-ProcessSheetXml $notesTitle $notes $noteHeaders))
  $app = Read-ZipXml $sourceZip 'docProps/app.xml'
  $appMgr = [Xml.XmlNamespaceManager]::new($app.NameTable); $appMgr.AddNamespace('ep',$epNs); $appMgr.AddNamespace('vt',$vtNs)
  $countNode = $app.SelectSingleNode('/ep:Properties/ep:HeadingPairs/vt:vector/vt:variant[2]/vt:i4', $appMgr)
  if ($countNode) { $countNode.InnerText = [string](3 + $specs.Count) }
  $titlesVector = $app.SelectSingleNode('/ep:Properties/ep:TitlesOfParts/vt:vector', $appMgr)
  if ($titlesVector) {
    while ($titlesVector.HasChildNodes) { [void]$titlesVector.RemoveChild($titlesVector.FirstChild) }
    $allNames = @('Process Menu','L1','Developer Notes') + $tabNames
    $titlesVector.SetAttribute('size', [string]$allNames.Count)
    foreach ($name in $allNames) { $lp = $app.CreateElement('vt','lpstr',$vtNs); $lp.InnerText = $name; [void]$titlesVector.AppendChild($lp) }
  }

  $replacements = @{
    '[Content_Types].xml' = (Xml-Bytes $ct)
    'xl/workbook.xml' = (Xml-Bytes $workbook)
    'xl/_rels/workbook.xml.rels' = (Xml-Bytes $rels)
    'xl/worksheets/sheet1.xml' = $menuBytes
    'xl/worksheets/sheet3.xml' = $notesBytes
    'docProps/app.xml' = (Xml-Bytes $app)
  }
  $outStream = [IO.FileStream]::new($OutputPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
  $destZip = [IO.Compression.ZipArchive]::new($outStream, [IO.Compression.ZipArchiveMode]::Create, $true)
  try {
    foreach ($entry in $sourceZip.Entries) {
      if ($replacements.ContainsKey($entry.FullName)) {
        Add-ZipBytes $destZip $entry.FullName $replacements[$entry.FullName]
      } else {
        $newEntry = $destZip.CreateEntry($entry.FullName, [IO.Compression.CompressionLevel]::Optimal)
        $srcStream = $entry.Open(); $dstStream = $newEntry.Open()
        try { $srcStream.CopyTo($dstStream) } finally { $srcStream.Dispose(); $dstStream.Dispose() }
      }
    }
    foreach ($part in $processParts) { Add-ZipBytes $destZip $part.name $part.bytes }
  } finally { $destZip.Dispose(); $outStream.Dispose() }
} finally { $sourceZip.Dispose() }

$fi = Get-Item -LiteralPath $OutputPath
Write-Output "Created: $($fi.FullName)"
Write-Output "Bytes: $($fi.Length)"
Write-Output "New process tabs: $($specs.Count)"
Write-Output "All tabs: Process Menu, L1, Developer Notes, $($tabNames -join ', ')"
