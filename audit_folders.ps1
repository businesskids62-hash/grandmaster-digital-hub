param([string[]]$Roots)
$results = @()
foreach ($root in $Roots) {
    if (-not (Test-Path $root)) { continue }
    Get-ChildItem -Path $root -Directory -Force -ErrorAction SilentlyContinue | ForEach-Object {
        $s = (Get-ChildItem -Path $_.FullName -Recurse -Force -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
        $results += [pscustomobject]@{Folder=$_.FullName; SizeMB=[math]::Round($s/1MB,2)}
    }
}
$results | Sort-Object SizeMB -Descending | Select-Object -First 15 | Format-Table -AutoSize