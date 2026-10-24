$npmCache = npm config get cache 2>$null
if ($npmCache -and (Test-Path $npmCache)) {
    Get-ChildItem -Path $npmCache -Directory -Force -ErrorAction SilentlyContinue | ForEach-Object {
        $s = (Get-ChildItem -Path $_.FullName -Recurse -Force -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
        [pscustomobject]@{Folder=$_.FullName; SizeMB=[math]::Round($s/1MB,2)}
    } | Sort-Object SizeMB -Descending | Select-Object -First 15 | Format-Table -AutoSize
} else {
    Write-Host "npm cache not found or empty"
}