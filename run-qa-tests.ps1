
# DocLens AI Platform - Full QA Test Suite
# Waits 30s then runs all 17 tests against localhost:3001 and localhost:8000

$BASE = "http://localhost:3001/api/v1"
$AI   = "http://localhost:8000"
$results = @()
$token = $null
$workspaceId = $null
$collectionId = $null

function Invoke-ApiTest {
    param(
        [string]$TestName,
        [string]$Method,
        [string]$Url,
        [hashtable]$Body = $null,
        [string]$Token = $null,
        [int[]]$ExpectStatus = @(200,201),
        [string]$Note = ""
    )

    $headers = @{ "Content-Type" = "application/json" }
    if ($Token) { $headers["Authorization"] = "Bearer $Token" }

    $bodyJson = if ($Body) { $Body | ConvertTo-Json -Compress } else { $null }

    $status = 0
    $responseBody = ""
    $pass = $false
    $error_msg = ""

    try {
        $params = @{
            Uri     = $Url
            Method  = $Method
            Headers = $headers
            UseBasicParsing = $true
            ErrorAction = "Stop"
        }
        if ($bodyJson) {
            $params["Body"] = $bodyJson
        }

        $resp = Invoke-WebRequest @params
        $status = [int]$resp.StatusCode
        $responseBody = $resp.Content | ConvertFrom-Json -ErrorAction SilentlyContinue
        if (-not $responseBody) { $responseBody = $resp.Content }
        $pass = $ExpectStatus -contains $status
    }
    catch {
        $ex = $_.Exception
        if ($ex.Response) {
            $status = [int]$ex.Response.StatusCode
            try {
                $stream = $ex.Response.GetResponseStream()
                $reader = New-Object System.IO.StreamReader($stream)
                $responseBody = $reader.ReadToEnd() | ConvertFrom-Json -ErrorAction SilentlyContinue
                if (-not $responseBody) { $responseBody = $reader.ReadToEnd() }
            } catch {}
            $pass = $ExpectStatus -contains $status
        } else {
            $error_msg = $ex.Message
            $pass = $false
        }
    }

    $keyData = if ($responseBody -is [string]) { $responseBody.Substring(0, [Math]::Min(200, $responseBody.Length)) } else { ($responseBody | ConvertTo-Json -Depth 2 -Compress).Substring(0, [Math]::Min(300, ($responseBody | ConvertTo-Json -Depth 2 -Compress).Length)) }

    $result = [PSCustomObject]@{
        test       = $TestName
        status     = if ($pass) { "PASS" } else { "FAIL" }
        httpCode   = $status
        note       = $Note
        keyData    = $keyData
        error      = $error_msg
    }

    $color = if ($pass) { "Green" } else { "Red" }
    Write-Host "[$($result.status)] $TestName  (HTTP $status)" -ForegroundColor $color
    if ($error_msg) { Write-Host "  ERROR: $error_msg" -ForegroundColor Yellow }
    Write-Host "  $keyData" -ForegroundColor Gray

    return $result, $responseBody
}

# ─── Wait for services ──────────────────────────────────────────────────────
Write-Host "`n⏳ Waiting 30 seconds for services to start..." -ForegroundColor Cyan
Start-Sleep -Seconds 30
Write-Host "✅ Starting tests now...`n" -ForegroundColor Cyan

# ═══════════════════════════════════════════════════════════════════════════
# AUTH TESTS
# ═══════════════════════════════════════════════════════════════════════════
Write-Host "=== AUTH TESTS ===" -ForegroundColor Cyan

# Test 1: Register
$r1, $b1 = Invoke-ApiTest -TestName "1. POST /auth/register" `
    -Method POST -Url "$BASE/auth/register" `
    -Body @{ email="qa_test@doclens.ai"; password="Test@1234"; name="QA User" } `
    -ExpectStatus @(200,201,409) `
    -Note "Register new user (409 ok if already exists)"
$results += $r1

# Test 2: Login admin
$r2, $b2 = Invoke-ApiTest -TestName "2. POST /auth/login (admin)" `
    -Method POST -Url "$BASE/auth/login" `
    -Body @{ email="admin@doclens.ai"; password="Admin@1234" } `
    -ExpectStatus @(200,201) `
    -Note "Login and save token"
$results += $r2

if ($b2 -and $b2.accessToken) {
    $token = $b2.accessToken
    Write-Host "  ✅ Token captured: $($token.Substring(0,40))..." -ForegroundColor Green
} elseif ($b2 -and $b2.data -and $b2.data.accessToken) {
    $token = $b2.data.accessToken
    Write-Host "  ✅ Token captured from .data: $($token.Substring(0,40))..." -ForegroundColor Green
} elseif ($b2 -and $b2.token) {
    $token = $b2.token
    Write-Host "  ✅ Token captured from .token: $($token.Substring(0,40))..." -ForegroundColor Green
} else {
    Write-Host "  ⚠️  Could not extract token from response" -ForegroundColor Yellow
}

# Test 3: Login with wrong password
$r3, $b3 = Invoke-ApiTest -TestName "3. POST /auth/login (wrong password)" `
    -Method POST -Url "$BASE/auth/login" `
    -Body @{ email="admin@doclens.ai"; password="WrongPass99" } `
    -ExpectStatus @(401,400,403) `
    -Note "Expect 401 unauthorized"
$results += $r3

# Test 4: GET /auth/me with token
$r4, $b4 = Invoke-ApiTest -TestName "4. GET /auth/me (with token)" `
    -Method GET -Url "$BASE/auth/me" `
    -Token $token `
    -ExpectStatus @(200) `
    -Note "Expect user profile"
$results += $r4

# Test 5: GET /auth/me without token
$r5, $b5 = Invoke-ApiTest -TestName "5. GET /auth/me (no token)" `
    -Method GET -Url "$BASE/auth/me" `
    -ExpectStatus @(401,403) `
    -Note "Expect 401"
$results += $r5

# ═══════════════════════════════════════════════════════════════════════════
# WORKSPACE TESTS
# ═══════════════════════════════════════════════════════════════════════════
Write-Host "`n=== WORKSPACE TESTS ===" -ForegroundColor Cyan

# Test 6: Create workspace
$r6, $b6 = Invoke-ApiTest -TestName "6. POST /workspaces" `
    -Method POST -Url "$BASE/workspaces" `
    -Body @{ name="QA Workspace"; description="Test workspace" } `
    -Token $token `
    -ExpectStatus @(200,201) `
    -Note "Create workspace"
$results += $r6

if ($b6) {
    if ($b6.id) { $workspaceId = $b6.id }
    elseif ($b6.data -and $b6.data.id) { $workspaceId = $b6.data.id }
    elseif ($b6._id) { $workspaceId = $b6._id }
    if ($workspaceId) { Write-Host "  ✅ Workspace ID: $workspaceId" -ForegroundColor Green }
}

# Test 7: GET /workspaces
$r7, $b7 = Invoke-ApiTest -TestName "7. GET /workspaces" `
    -Method GET -Url "$BASE/workspaces" `
    -Token $token `
    -ExpectStatus @(200) `
    -Note "List workspaces"
$results += $r7

# If we didn't get workspace ID from create, try to get from list
if (-not $workspaceId -and $b7) {
    $list = if ($b7 -is [array]) { $b7 } elseif ($b7.data) { $b7.data } else { $null }
    if ($list -and $list.Count -gt 0) {
        $workspaceId = if ($list[0].id) { $list[0].id } else { $list[0]._id }
        Write-Host "  ✅ Workspace ID from list: $workspaceId" -ForegroundColor Green
    }
}

# Test 8: PATCH workspace
$patchUrl = if ($workspaceId) { "$BASE/workspaces/$workspaceId" } else { "$BASE/workspaces/unknown" }
$r8, $b8 = Invoke-ApiTest -TestName "8. PATCH /workspaces/{id}" `
    -Method PATCH -Url $patchUrl `
    -Body @{ name="Updated QA Workspace" } `
    -Token $token `
    -ExpectStatus @(200,201) `
    -Note "Update workspace name"
$results += $r8

# Test 9: POST /collections
$colBody = @{ name="QA Collection" }
if ($workspaceId) { $colBody["workspaceId"] = $workspaceId }
$r9, $b9 = Invoke-ApiTest -TestName "9. POST /collections" `
    -Method POST -Url "$BASE/collections" `
    -Body $colBody `
    -Token $token `
    -ExpectStatus @(200,201) `
    -Note "Create collection"
$results += $r9

if ($b9) {
    if ($b9.id) { $collectionId = $b9.id }
    elseif ($b9.data -and $b9.data.id) { $collectionId = $b9.data.id }
    elseif ($b9._id) { $collectionId = $b9._id }
    if ($collectionId) { Write-Host "  ✅ Collection ID: $collectionId" -ForegroundColor Green }
}

# Test 10: GET /collections?workspaceId=...
$colListUrl = if ($workspaceId) { "$BASE/collections?workspaceId=$workspaceId" } else { "$BASE/collections" }
$r10, $b10 = Invoke-ApiTest -TestName "10. GET /collections?workspaceId=..." `
    -Method GET -Url $colListUrl `
    -Token $token `
    -ExpectStatus @(200) `
    -Note "List collections for workspace"
$results += $r10

# ═══════════════════════════════════════════════════════════════════════════
# AI SERVICE TESTS
# ═══════════════════════════════════════════════════════════════════════════
Write-Host "`n=== AI SERVICE TESTS ===" -ForegroundColor Cyan

# Test 11: AI Health
$r11, $b11 = Invoke-ApiTest -TestName "11. GET /health (AI Service)" `
    -Method GET -Url "$AI/health" `
    -ExpectStatus @(200) `
    -Note "AI service health check"
$results += $r11

# Test 12: POST /query/ask
$r12, $b12 = Invoke-ApiTest -TestName "12. POST /query/ask" `
    -Method POST -Url "$AI/query/ask" `
    -Body @{ question="test"; collection_id="test"; top_k=3 } `
    -ExpectStatus @(200,201,404,422,400) `
    -Note "AI query endpoint"
$results += $r12

# Test 13: GET /graph/entities
$r13, $b13 = Invoke-ApiTest -TestName "13. GET /graph/entities?collection_id=test" `
    -Method GET -Url "$AI/graph/entities?collection_id=test" `
    -ExpectStatus @(200,404) `
    -Note "Graph entities"
$results += $r13

# Test 14: GET /graph/insights
$r14, $b14 = Invoke-ApiTest -TestName "14. GET /graph/insights?collection_id=test" `
    -Method GET -Url "$AI/graph/insights?collection_id=test" `
    -ExpectStatus @(200,404) `
    -Note "Graph insights"
$results += $r14

# ═══════════════════════════════════════════════════════════════════════════
# SECURITY TESTS
# ═══════════════════════════════════════════════════════════════════════════
Write-Host "`n=== SECURITY TESTS ===" -ForegroundColor Cyan

# Test 15: No token on /workspaces
$r15, $b15 = Invoke-ApiTest -TestName "15. GET /workspaces (no token)" `
    -Method GET -Url "$BASE/workspaces" `
    -ExpectStatus @(401,403) `
    -Note "Expect 401 when unauthenticated"
$results += $r15

# Test 16: fake workspace ID
$r16, $b16 = Invoke-ApiTest -TestName "16. GET /collections?workspaceId=fake-id" `
    -Method GET -Url "$BASE/collections?workspaceId=fake-id" `
    -Token $token `
    -ExpectStatus @(200,404,400) `
    -Note "Expect 404 or empty list for fake ID"
$results += $r16

# Test 17: DELETE with fake uuid
$r17, $b17 = Invoke-ApiTest -TestName "17. DELETE /workspaces/fake-uuid" `
    -Method DELETE -Url "$BASE/workspaces/00000000-0000-0000-0000-000000000000" `
    -Token $token `
    -ExpectStatus @(404,400) `
    -Note "Expect 404 for non-existent workspace"
$results += $r17

# ═══════════════════════════════════════════════════════════════════════════
# SUMMARY
# ═══════════════════════════════════════════════════════════════════════════
Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "           SUMMARY TABLE" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
$pass = ($results | Where-Object { $_.status -eq "PASS" }).Count
$fail = ($results | Where-Object { $_.status -eq "FAIL" }).Count
foreach ($r in $results) {
    $c = if ($r.status -eq "PASS") { "Green" } else { "Red" }
    Write-Host ("  {0,-45} {1,-5} HTTP {2}" -f $r.test, $r.status, $r.httpCode) -ForegroundColor $c
}
Write-Host "`nTotal: $($results.Count) | PASS: $pass | FAIL: $fail" -ForegroundColor Cyan

# Save JSON report
$report = @{
    timestamp  = (Get-Date -Format "yyyy-MM-ddTHH:mm:ssZ")
    summary    = @{ total=$results.Count; pass=$pass; fail=$fail }
    results    = $results
}
$report | ConvertTo-Json -Depth 5 | Set-Content -Path "d:\DockerData\ledgerX\qa-report.json" -Encoding UTF8
Write-Host "`n✅ Report saved to d:\DockerData\ledgerX\qa-report.json" -ForegroundColor Green
