param(
  [Parameter(Mandatory = $true)]
  [string]$StartDate,

  [Parameter(Mandatory = $true)]
  [string]$EndDate
)

$ErrorActionPreference = "Continue"
$start = [DateTime]::Parse($StartDate)
$end = [DateTime]::Parse($EndDate)

if ($end -lt $start) {
  throw "EndDate 不可以早於 StartDate"
}

$root = Split-Path -Parent $PSScriptRoot
$apiPath = Join-Path $root "stock-radar-api"
Set-Location $apiPath

$current = $start
while ($current -le $end) {
  $isWeekend = $current.DayOfWeek -eq [DayOfWeek]::Saturday -or $current.DayOfWeek -eq [DayOfWeek]::Sunday
  $dateText = $current.ToString("yyyy-MM-dd")

  if ($isWeekend) {
    Write-Host "略過週末：$dateText"
    $current = $current.AddDays(1)
    continue
  }

  Write-Host "=============================="
  Write-Host "匯入交易日：$dateText"
  Write-Host "=============================="

  npm run import:twse -- $dateText
  if ($LASTEXITCODE -ne 0) {
    Write-Host "上市匯入失敗或休市：$dateText，繼續下一步"
  }

  npm run import:tpex -- $dateText
  if ($LASTEXITCODE -ne 0) {
    Write-Host "上櫃匯入失敗或休市：$dateText，繼續下一步"
  }

  npm run score -- $dateText
  if ($LASTEXITCODE -ne 0) {
    Write-Host "籌碼分數計算失敗：$dateText，可能是當天沒有資料"
  }

  $current = $current.AddDays(1)
}

Write-Host "歷史資料補匯完成"
