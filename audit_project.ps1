$root = 'D:\GrandmasterDigitalHub'
$targets = @('node_modules','dist','logs')
$results = @()
foreach $t in $targets {
    $p = Join-Path $root $t
    if (-not (Test-Path $p)) { continue }
    $s = (Get-ChildItem -Path $p -Recurse -Force -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
    $results += [pscustomobject]@{Folder=$p; SizeMB=[math]::Round($s/1MB,2)}
}
$results | Sort-Object SizeMB -Descending | Format-Table -AutoSize