$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$manifest = Get-Content -LiteralPath (Join-Path $projectRoot 'manifest.json') -Raw | ConvertFrom-Json
$metadata = Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json
if ($manifest.version -notmatch '^\d+\.\d+\.\d+$' -or $manifest.version -ne $metadata.version) { throw 'Release versions differ' }
$releaseDir = Join-Path $projectRoot 'output'
[void][System.IO.Directory]::CreateDirectory($releaseDir)
$zipPath = Join-Path $releaseDir ('Meow-Preset-Tools-' + $manifest.version + '.zip')
$files = Get-ChildItem -LiteralPath $projectRoot -File | Where-Object {
    $_.Extension -in '.js', '.mjs', '.css' -or $_.Name -in 'manifest.json', 'package.json', 'README.md', 'LICENSE', 'validation-2026-11-14.md', 'validation-tt-2026-11-14.md'
} | Sort-Object Name
foreach ($entry in $manifest.js, $manifest.css) {
    if ($entry -notin $files.Name) { throw "Missing manifest entry: $entry" }
}
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$stream = [System.IO.File]::Open($zipPath, [System.IO.FileMode]::Create)
try {
    $archive = [System.IO.Compression.ZipArchive]::new($stream, [System.IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach ($file in $files) {
            [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $file.FullName, ('Meow-Preset-Tools/' + $file.Name))
        }
    } finally { $archive.Dispose() }
} finally { $stream.Dispose() }
Write-Output $zipPath
Write-Output ('Packaged files: ' + $files.Count)
